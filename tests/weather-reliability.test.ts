import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDataGovClient, DataGovHttpError } from '../server/providers/dataGovClient.ts';
import { createRainService, normalizeRain } from '../server/weather/rainService.ts';
import { createRainResource } from '../src/features/weather/rainResource.ts';
import { rainNotice } from '../src/features/weather/rainFreshness.ts';
import { FeedHttpError, fetchFeed } from '../src/utils/feedResponse.ts';
import { retryAfterMs } from '../shared/httpRetry.ts';
import { isRainForecast, rainIsValid } from '../shared/weather/rain.ts';
import type { FeedResponse } from '../src/utils/feedResponse.ts';

const tick = () => new Promise<void>((r) => setImmediate(r));
const start = Date.parse('2026-10-20T01:00:00Z');
function fixture() {
  return {
    area_metadata: [{ name: 'Woodlands', label_location: { latitude: 1.44, longitude: 103.77 } }],
    items: [
      {
        timestamp: '2026-10-20T09:00:00+08:00',
        update_timestamp: '2026-10-20T09:01:00+08:00',
        valid_period: { start: '2026-10-20T09:00:00+08:00', end: '2026-10-20T11:00:00+08:00', text: '9 am to 11 am' },
        forecasts: [{ area: 'Woodlands', forecast: 'Showers' }],
      },
    ],
  };
}
function clientHarness(overrides = {}) {
  let now = start;
  const starts: number[] = [],
    waits: number[] = [];
  let reply: (input: unknown) => Promise<Response> = async () => Response.json({ code: 0, data: { result: 'ok' } });
  const client = createDataGovClient({
    fetch: async (input) => {
      starts.push(now);
      return reply(input);
    },
    now: () => now,
    random: () => 0,
    sleep: async (ms) => {
      waits.push(ms);
      await tick();
      now += ms;
    },
    intervalMs: 2100,
    retryDelayMs: 10000,
    maxRetryWaitMs: 12000,
    timeoutMs: 1000,
    ...overrides,
  });
  return {
    client,
    starts,
    waits,
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
    reply: (fn: typeof reply) => {
      reply = fn;
    },
  };
}

test('Retry-After parses seconds and HTTP dates without retaining supplied text', () => {
  assert.equal(retryAfterMs('10', start), 10000);
  assert.equal(retryAfterMs('Tue, 20 Oct 2026 01:00:12 GMT', start), 12000);
  assert.equal(retryAfterMs('Tue, 20 Oct 2026 00:00:00 GMT', start), 0);
  for (const value of [null, '', '-1', '1.2', 'invalid-private-text', '999999999999999999999'])
    assert.equal(retryAfterMs(value, start), null);
});

test('seven keyless health-style requests are paced over more than ten seconds and duplicates coalesce', async () => {
  const h = clientHarness();
  const a = h.client.data('https://example.test/0', { retry: false });
  assert.equal(h.client.data('https://example.test/0', { retry: false }), a);
  await Promise.all([
    a,
    ...Array.from({ length: 6 }, (_, i) => h.client.data(`https://example.test/${i + 1}`, { retry: false })),
  ]);
  assert.equal(h.starts.length, 7);
  assert.ok(h.starts[6] - h.starts[0] >= 12600);
  assert.ok(h.starts.every((at, i) => i === 0 || at - h.starts[i - 1] >= 2100));
});

test('one 429 retry waits for provider guidance; retries stop and unrelated calls observe cooldown', async () => {
  const h = clientHarness();
  let calls = 0;
  h.reply(async () =>
    ++calls === 1
      ? new Response('private-provider-body', { status: 429, headers: { 'Retry-After': '11' } })
      : Response.json({ code: 0, data: { ok: true } }),
  );
  assert.deepEqual(await h.client.data('https://example.test/rain'), { ok: true });
  assert.equal(h.starts.length, 2);
  assert.ok(h.starts[1] - h.starts[0] >= 11000);
  h.reply(async () => new Response('private-provider-body', { status: 429, headers: { 'Retry-After': '60' } }));
  await assert.rejects(h.client.data('https://example.test/other'), (error: unknown) => {
    assert.ok(error instanceof DataGovHttpError);
    assert.equal(error.retryAt, h.now() + 60000);
    assert.ok(!JSON.stringify(error).includes('private'));
    return true;
  });
  const previous = h.starts.length;
  await assert.rejects(h.client.data('https://example.test/third'), DataGovHttpError);
  assert.equal(h.starts.length, previous);
  assert.ok(!h.waits.includes(60000));
});

test('429 fallback has one bounded retry, while probes and non-429 failures never retry', async () => {
  for (const [status, retry, expected] of [
    [429, true, 2],
    [429, false, 1],
    [500, true, 1],
  ] as const) {
    const h = clientHarness();
    h.reply(async () => new Response(null, { status }));
    await assert.rejects(h.client.data('https://example.test', { retry }), DataGovHttpError);
    assert.equal(h.starts.length, expected);
    if (expected === 2) assert.ok(h.starts[1] - h.starts[0] >= 10000);
  }
});

test('wrapped failures and invalid forecasts are rejected without using provider messages', async () => {
  const h = clientHarness();
  h.reply(async () => Response.json({ code: 1, errorMsg: 'private-provider-text' }));
  await assert.rejects(h.client.data('https://example.test'), { message: 'Unexpected provider payload' });
  assert.equal(isRainForecast({ ...normalizeRain(fixture()), areas: [] }), false);
  assert.equal(isRainForecast({ ...normalizeRain(fixture()), validPeriod: { start: 3, end: null } }), false);
  assert.equal(
    isRainForecast({ ...normalizeRain(fixture()), areas: [{ name: 'x', forecast: 'Rain', lat: NaN, lon: 103 }] }),
    false,
  );
  assert.throws(() => normalizeRain({ ...fixture(), items: [] }), /Unexpected forecast/);
  const data = normalizeRain(fixture());
  assert.equal(rainIsValid(data, start), true);
  assert.equal(rainIsValid(data, start + 7200000), false);
});

function serviceHarness() {
  let now = start,
    calls = 0,
    failures = 0;
  let reply: () => Promise<unknown> = async () => {
    await tick();
    return fixture();
  };
  const service = createRainService({
    fetch: () => {
      calls++;
      return reply();
    },
    now: () => now,
    ttlMs: 300000,
    maxRetainedMs: 1800000,
    onFailure: () => {
      failures++;
    },
  });
  return {
    service,
    calls: () => calls,
    failures: () => failures,
    advance: (ms: number) => {
      now += ms;
    },
    reply: (fn: typeof reply) => {
      reply = fn;
    },
    now: () => now,
  };
}

test('rain server shares pending refreshes and fresh cache preserves original timestamps and TTL', async () => {
  const h = serviceHarness();
  const a = h.service.get(),
    b = h.service.get();
  assert.equal(a, b);
  const first = await a;
  assert.equal(h.calls(), 1);
  assert.equal(first.cacheSeconds, 300);
  h.advance(60000);
  const second = await h.service.get();
  assert.equal(second.data, first.data);
  assert.equal(second.cacheSeconds, 240);
  assert.equal(h.calls(), 1);
});

test('rain failure retains valid data with original received/issued time and obeys cooldown', async () => {
  const h = serviceHarness();
  const first = await h.service.get();
  h.advance(300000);
  h.reply(async () => {
    throw new DataGovHttpError(429, h.now() + 60000);
  });
  const retained = await h.service.get();
  assert.equal(retained.cacheSeconds, 0);
  assert.equal(retained.data.delivery?.state, 'retained');
  assert.equal(retained.data.delivery?.fetchedAt, first.data.delivery?.fetchedAt);
  assert.equal(retained.data.issuedAt, first.data.issuedAt);
  assert.deepEqual(retained.data.validPeriod, first.data.validPeriod);
  assert.equal(h.failures(), 1);
  await h.service.get();
  assert.equal(h.calls(), 2);
  h.advance(60001);
  h.reply(async () => fixture());
  assert.equal((await h.service.get()).data.delivery?.state, 'current');
});

test('rain fallback refuses expired or over-age observations and caps CDN TTL near expiry', async () => {
  for (const age of [1800001, 7200000]) {
    const h = serviceHarness();
    await h.service.get();
    h.advance(age);
    h.reply(async () => {
      throw new Error('unavailable');
    });
    await assert.rejects(h.service.get(), /unavailable/);
  }
  const h = serviceHarness();
  h.advance(7195000);
  assert.equal((await h.service.get()).cacheSeconds, 5);
  h.advance(5000);
  await assert.rejects(h.service.get(), /outside validity/);
});

function resourceHarness() {
  let now = start,
    calls = 0;
  let listener: (() => void) | undefined;
  const timers = new Map<() => void, number>();
  let reply: () => Promise<FeedResponse<unknown>> = async () => ({
    data: normalizeRain(fixture()),
    offline: false,
    receivedAt: now,
  });
  const resource = createRainResource({
    fetch: () => {
      calls++;
      return reply();
    },
    now: () => now,
    pollMs: 300000,
    retryMs: 30000,
    schedule: (run, ms) => {
      timers.set(run, ms);
      return () => {
        timers.delete(run);
      };
    },
    onRefresh: (fn) => {
      assert.equal(listener, undefined);
      listener = fn;
      return () => {
        listener = undefined;
      };
    },
  });
  return {
    resource,
    timers,
    calls: () => calls,
    hasListener: () => !!listener,
    advance: (ms: number) => {
      now += ms;
    },
    now: () => now,
    reply: (fn: typeof reply) => {
      reply = fn;
    },
  };
}

test('rain browser consumers share one timer/listener and retained refreshes keep original data age', async () => {
  const h = resourceHarness();
  const a = h.resource.connect(() => {}),
    b = h.resource.connect(() => {});
  await tick();
  assert.equal(h.calls(), 1);
  assert.equal(h.timers.size, 1);
  const first = h.resource.getSnapshot();
  h.advance(300000);
  h.reply(async () => {
    throw new FeedHttpError(502, h.now() + 60000);
  });
  await h.resource.refresh();
  assert.equal(h.resource.getSnapshot().data, first.data);
  assert.equal(h.resource.getSnapshot().fetchedAt, first.fetchedAt);
  assert.match(rainNotice(h.resource.getSnapshot(), h.now())!.detail, /retained forecast/);
  await h.resource.refresh();
  assert.equal(h.calls(), 2); // manual clicks cannot bypass Retry-After
  assert.equal([...h.timers.values()][0], 60000);
  a();
  assert.equal(h.hasListener(), true);
  b();
  assert.equal(h.hasListener(), false);
  assert.equal(h.timers.size, 0);
});

test('rain browser recovery, server-retained/offline metadata and expiry remain honest', async () => {
  const h = resourceHarness(),
    stop = h.resource.connect(() => {});
  await tick();
  const first = h.resource.getSnapshot();
  h.reply(async () => ({
    data: { ...normalizeRain(fixture()), delivery: { state: 'retained', fetchedAt: new Date(start).toISOString() } },
    offline: false,
    receivedAt: h.now(),
  }));
  h.advance(300000);
  await h.resource.refresh();
  assert.equal(h.resource.getSnapshot().status, 'error');
  assert.equal(h.resource.getSnapshot().fetchedAt, start);
  h.reply(async () => ({ data: normalizeRain(fixture()), offline: true, receivedAt: h.now() }));
  await h.resource.refresh();
  assert.equal(h.resource.getSnapshot().fetchedAt, first.fetchedAt);
  h.reply(async () => ({ data: normalizeRain(fixture()), offline: false, receivedAt: h.now() }));
  await h.resource.refresh();
  assert.equal(h.resource.getSnapshot().status, 'live');
  h.advance(7200000);
  assert.match(rainNotice(h.resource.getSnapshot(), h.now())!.detail, /expired/);
  stop();
});

test('rain request finishing after disposal cannot restart polling', async () => {
  const h = resourceHarness();
  let release!: () => void;
  h.reply(
    () =>
      new Promise((resolve) => {
        release = () => resolve({ data: normalizeRain(fixture()), offline: false, receivedAt: start });
      }),
  );
  const stop = h.resource.connect(() => {});
  await tick();
  stop();
  release();
  await tick();
  assert.equal(h.timers.size, 0);
  assert.equal(h.hasListener(), false);
});

test('browser HTTP failures carry only numeric retry metadata, never response text', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('private-error-body', { status: 502, headers: { 'Retry-After': '60' } });
  try {
    await assert.rejects(fetchFeed('/api/fixture-retry'), (error: unknown) => {
      assert.ok(error instanceof FeedHttpError);
      assert.equal(error.message, 'HTTP 502');
      assert.ok(error.retryAt! > Date.now());
      assert.ok(!JSON.stringify(error).includes('private'));
      return true;
    });
  } finally {
    globalThis.fetch = original;
  }
});

test('rain Node/Web adapters preserve delivery age, mark retained data no-store, and keep health failures visible', async () => {
  process.env.DATA_GOV_MIN_INTERVAL_MS = '0';
  process.env.DATA_GOV_RETRY_DELAY_MS = '0';
  process.env.RAIN_CACHE_TTL_MS = '0';
  const handler = (await import('../api/rainforecast.ts')).default;
  const { probeDataGov } = await import('../server/healthProbes.ts');
  const originalFetch = globalThis.fetch,
    originalLog = console.error;
  const logs: string[] = [];
  console.error = (...args) => {
    logs.push(JSON.stringify(args));
  };
  const nodeRes = () => ({
    code: 0,
    body: undefined as any,
    headers: {} as Record<string, string>,
    setHeader(key: string, value: string) {
      this.headers[key.toLowerCase()] = value;
    },
    status(code: number) {
      this.code = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  });
  try {
    for (const mode of ['node', 'web']) {
      const data = fixture(),
        now = Date.now();
      Object.assign(data.items[0], {
        timestamp: new Date(now - 60000).toISOString(),
        valid_period: {
          start: new Date(now - 60000).toISOString(),
          end: new Date(now + 3600000).toISOString(),
          text: 'Current fixture',
        },
      });
      globalThis.fetch = async () => Response.json({ code: 0, data });
      const res = mode === 'node' ? nodeRes() : undefined;
      const current = (await handler({ method: 'GET', url: '/api/rainforecast' }, res)) as Response;
      const first = res ? res.body : await current.json();
      assert.equal(first.delivery.state, 'current');
      globalThis.fetch = async () => new Response('private-provider-body', { status: 500 });
      const failedRes = mode === 'node' ? nodeRes() : undefined;
      const retained = (await handler({ method: 'GET', url: '/api/rainforecast' }, failedRes)) as Response;
      const fallback = failedRes ? failedRes.body : await retained.json();
      assert.equal(fallback.delivery.state, 'retained');
      assert.equal(fallback.delivery.fetchedAt, first.delivery.fetchedAt);
      assert.equal(failedRes ? failedRes.headers['cache-control'] : retained.headers.get('Cache-Control'), 'no-store');
      const probe = await probeDataGov('https://example.test/rain');
      assert.equal(probe.status, 'DOWN');
      assert.equal(probe.httpCode, 500);
      assert.ok(!JSON.stringify([fallback, probe, logs]).includes('private-provider-body'));
    }
    globalThis.fetch = async () =>
      new Response('private-provider-body', { status: 429, headers: { 'Retry-After': '60' } });
    const response = (await handler({ method: 'GET', url: '/api/rainforecast' })) as Response;
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.ok(Number(response.headers.get('Retry-After')) > 0);
    const limited = await probeDataGov('https://example.test/other');
    assert.equal(limited.status, 'DOWN');
    assert.equal(limited.httpCode, 429);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalLog;
  }
});
