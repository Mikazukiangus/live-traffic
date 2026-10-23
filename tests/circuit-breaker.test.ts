import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCircuitRunner, circuitFailure } from '../server/http/circuitBreaker.ts';
import { providerCircuitScope, withProviderCircuit } from '../server/http/providerCircuits.ts';
import { createProviderReader } from '../server/http/readProvider.ts';
import { createDataGovClient } from '../server/providers/dataGovClient.ts';
import { providerFailureHeaders, providerFailureStatus } from '../server/http/providerFailure.ts';
import { CircuitOpenError, InvalidPayloadError, safeFailure, UpstreamHttpError } from '../shared/diagnostics.ts';
import { SsrfError } from '../server/http/ssrf.ts';
import { createRainService } from '../server/weather/rainService.ts';
import { probe } from '../server/healthProbes.ts';
import { config } from '../config/server.ts';
import { createConfig } from '../config/schema.ts';
import cameras from '../api/trafficimages.ts';
import airquality from '../api/airquality.ts';
import { sendJson } from '../server/http/responses.ts';

const fail = async () => { throw new UpstreamHttpError(503); };
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function harness() {
  let now = 100000;
  const circuit = createCircuitRunner({ failureThreshold: 5, windowMs: 60000, cooldownMs: 30000 },
    url => new URL(url).pathname, () => now);
  const url = 'https://example.test/feed';
  return { circuit, url, now: () => now, advance: (ms: number) => { now += ms; },
    trip: async () => { for (let i = 0; i < 5; i++) await assert.rejects(circuit(url, fail), UpstreamHttpError); } };
}

test('five final failures open a feed for exactly 30 seconds; blocked calls do no work and do not extend it', async () => {
  const h = harness();
  for (let i = 0; i < 4; i++) await assert.rejects(h.circuit(h.url, fail), UpstreamHttpError);
  let attempts = 0;
  await assert.rejects(h.circuit(h.url, async () => { attempts++; return fail(); }), UpstreamHttpError);
  for (const elapsed of [0, 1000, 28999]) {
    h.advance(elapsed);
    await assert.rejects(h.circuit(h.url, async () => { attempts++; return true; }),
      (e: unknown) => e instanceof CircuitOpenError && e.retryAt === 130000);
  }
  assert.equal(attempts, 1);
  h.advance(1);
  assert.equal(await h.circuit(h.url, async permit => { assert.equal(permit.recovery, true); return 'ok'; }), 'ok');
  await h.circuit(h.url, async permit => assert.equal(permit.recovery, false));
});

test('success resets recent failures, old failures age out, and unrelated feeds remain available', async () => {
  const h = harness();
  for (let i = 0; i < 4; i++) await assert.rejects(h.circuit(h.url, fail));
  await h.circuit(h.url, async () => 'success');
  for (let i = 0; i < 4; i++) await assert.rejects(h.circuit(h.url, fail));
  h.advance(60000);
  await assert.rejects(h.circuit(h.url, fail));
  // A window boundary expires the previous failures, so this read is admitted.
  await h.circuit(h.url, async () => 'success');
  await h.trip();
  assert.equal(await h.circuit('https://example.test/other', async () => 42), 42);
  const separate = harness();
  assert.equal(await separate.circuit(h.url, async () => 'different instance'), 'different instance');
});

test('only dependency outages count; rate limits, permanent errors, caller abort and security failures stay neutral', async () => {
  const ignored = [new UpstreamHttpError(429), new UpstreamHttpError(401), new UpstreamHttpError(404), new UpstreamHttpError(501), new UpstreamHttpError(505),
    new DOMException('caller', 'AbortError'), new SsrfError('SSRF_ADDRESS_BLOCKED'),
    Object.assign(new Error('tls'), { code: 'CERT_HAS_EXPIRED' }), new TypeError('unknown fetch failure')];
  for (const error of ignored) assert.equal(circuitFailure(error), false);
  for (const error of [new UpstreamHttpError(408), new UpstreamHttpError(500), new UpstreamHttpError(503),
    new InvalidPayloadError(), new SyntaxError('private'), new DOMException('deadline', 'TimeoutError'),
    Object.assign(new Error('socket'), { code: 'ECONNRESET' })]) assert.equal(circuitFailure(error), true);
  const h = harness();
  for (let i = 0; i < 4; i++) await assert.rejects(h.circuit(h.url, fail));
  for (const error of ignored) await assert.rejects(h.circuit(h.url, async () => { throw error; }));
  // Even a caller-provided TimeoutError abort reason is not an upstream outage.
  const caller = new AbortController();
  await assert.rejects(h.circuit(h.url, async () => {
    caller.abort(new DOMException('caller timeout', 'TimeoutError'));
    throw caller.signal.reason;
  }, caller.signal));
  await assert.rejects(h.circuit(h.url, fail), UpstreamHttpError);
  await assert.rejects(h.circuit(h.url, async () => true), CircuitOpenError);
});

test('half-open admits a single probe, failed recovery reopens, and neutral recovery permits a new probe', async () => {
  const h = harness(); await h.trip(); h.advance(30000);
  const trial = deferred<string>();
  const running = h.circuit(h.url, async permit => { assert.equal(permit.recovery, true); return trial.promise; });
  await assert.rejects(h.circuit(h.url, async () => 'must not run'), CircuitOpenError);
  const failure = assert.rejects(running, UpstreamHttpError);
  trial.reject(new UpstreamHttpError(503)); await failure;
  await assert.rejects(h.circuit(h.url, async () => true), (e: unknown) => e instanceof CircuitOpenError && e.retryAt === 160000);
  h.advance(30000);
  await assert.rejects(h.circuit(h.url, async () => { throw new UpstreamHttpError(429); }));
  await h.circuit(h.url, async permit => assert.equal(permit.recovery, true));
});

test('old in-flight results cannot close a new circuit, extend its cooldown or undo successful recovery', async () => {
  for (const lateFails of [true, false]) {
    const h = harness();
    const late = deferred<string>();
    const request = h.circuit(h.url, () => late.promise);
    const observed = request.catch(() => undefined);
    await h.trip(); h.advance(1000);
    if (lateFails) late.reject(new UpstreamHttpError(503)); else late.resolve('old success');
    await observed;
    await assert.rejects(h.circuit(h.url, async () => true), (e: unknown) => e instanceof CircuitOpenError && e.retryAt === 130000);
    h.advance(29000);
    await h.circuit(h.url, async () => true);
  }
  const h = harness(), late = deferred<string>();
  const request = h.circuit(h.url, () => late.promise).catch(() => undefined);
  await h.trip(); h.advance(30000); await h.circuit(h.url, async () => true);
  late.reject(new UpstreamHttpError(503)); await request;
  await h.circuit(h.url, async permit => assert.equal(permit.recovery, false));
});

test('registered scopes ignore page/date/signed parameters and isolate provider feed selectors and image hosts', () => {
  const u = config.server.upstreams;
  assert.equal(providerCircuitScope(`${u.speedBands}?$skip=500`), providerCircuitScope(`${u.speedBands}?$skip=99999`));
  assert.equal(providerCircuitScope(`${u.floods}?date=2026-10-23&paginationToken=private`), providerCircuitScope(u.floods));
  assert.notEqual(providerCircuitScope(u.lightning), providerCircuitScope(u.wbgt));
  assert.notEqual(providerCircuitScope(u.rain), providerCircuitScope(u.forecast24h));
  assert.notEqual(providerCircuitScope(u.images), providerCircuitScope(config.trafficImagesUrl));
  const a = providerCircuitScope('https://images.data.gov.sg/a.jpg?signature=private-a');
  assert.equal(a, providerCircuitScope('https://images.data.gov.sg/b.jpg?signature=private-b'));
  assert.notEqual(a, providerCircuitScope('https://dm-traffic-camera-itsc.s3.ap-southeast-1.amazonaws.com/a.jpg'));
  assert.ok(!a?.includes('private'));
  assert.equal(providerCircuitScope('https://unknown.test/feed'), null);
});

test('read retries count once after exhaustion, stop when another call trips, and recovery has one physical attempt', async () => {
  const h = harness(); let calls = 0;
  const read = createProviderReader({ circuit: h.circuit, now: h.now, random: () => 0,
    fetch: async () => { calls++; return new Response(null, { status: 503 }); },
    sleep: async ms => h.advance(ms) });
  for (let i = 0; i < 5; i++) await assert.rejects(read(h.url, r => r.json(), {}, { attempts: 3 }));
  assert.equal(calls, 15);
  await assert.rejects(read(h.url, r => r.json()), CircuitOpenError);
  assert.equal(calls, 15);
  h.advance(30000);
  await assert.rejects(read(h.url, r => r.json(), {}, { attempts: 4 }), UpstreamHttpError);
  assert.equal(calls, 16);
  const other = harness(); let physical = 0;
  const racing = createProviderReader({ circuit: other.circuit, now: other.now, random: () => 0,
    fetch: async () => { physical++; return new Response(null, { status: 503 }); },
    sleep: async () => other.trip() });
  await assert.rejects(racing(other.url, r => r.json()), CircuitOpenError);
  assert.equal(physical, 1, 'parallel page failures must stop the next retry');
});

test('weather retries and coalescing count logical failures; open feeds skip pacing and recovery never retries', async () => {
  const h = harness(); let calls = 0, sleeps = 0;
  const client = createDataGovClient({ circuit: h.circuit, now: h.now, random: () => 0,
    intervalMs: 2100, timeoutMs: 1000, budgetMs: 25000, transientRetryDelayMs: 400, retryDelayMs: 10000, maxRetryWaitMs: 12000,
    sleep: async ms => { sleeps++; h.advance(ms); },
    fetch: async () => { calls++; return new Response(null, { status: 503 }); } });
  for (let i = 0; i < 5; i++) {
    const a = client.data(h.url);
    assert.equal(client.data(h.url), a);
    await assert.rejects(a);
  }
  assert.equal(calls, 10);
  const pausedSleeps = sleeps;
  await assert.rejects(client.data(h.url), CircuitOpenError);
  assert.equal(sleeps, pausedSleeps);
  h.advance(30000);
  await assert.rejects(client.data(h.url), UpstreamHttpError);
  assert.equal(calls, 11);
});

test('retained rain keeps its original receipt/validity and circuit error stays 503 after retention expires', async () => {
  let now = Date.parse('2026-10-23T01:00:00Z'), calls = 0;
  const receipt = new Date(now).toISOString();
  const end = now + 60000;
  const service = createRainService({ now: () => now, ttlMs: 1000, maxRetainedMs: 10000, onFailure() {},
    fetch: async () => {
      if (++calls > 1) throw new CircuitOpenError(now + 30000);
      return { area_metadata: [{ name: 'Woodlands', label_location: { latitude: 1.44, longitude: 103.77 } }],
        items: [{ timestamp: receipt, update_timestamp: receipt,
          valid_period: { start: receipt, end: new Date(end).toISOString(), text: 'test' },
          forecasts: [{ area: 'Woodlands', forecast: 'Showers' }] }] };
    } });
  await service.get(); now += 1000;
  const retained = await service.get();
  assert.equal(retained.data.delivery?.state, 'retained');
  assert.equal(retained.data.delivery?.fetchedAt, receipt);
  assert.equal(retained.data.validPeriod.end, new Date(end).toISOString());
  assert.equal(retained.cacheSeconds, 0);
  now += 10000;
  await assert.rejects(service.get(), CircuitOpenError);
  assert.equal(calls, 2, 'cooldown must preserve the circuit error without another provider read');
});

test('circuit settings are bounded/server-only and 503 hints retain no-store with safe Node/Web diagnostics', async () => {
  const c = createConfig();
  assert.deepEqual(c.server.circuit, { failureThreshold: 5, windowMs: 60000, cooldownMs: 30000 });
  for (const env of [{ PROVIDER_CIRCUIT_FAILURE_THRESHOLD: '0' }, { PROVIDER_CIRCUIT_WINDOW_MS: '-1' }, { PROVIDER_CIRCUIT_COOLDOWN_MS: 'Infinity' }])
    assert.throws(() => createConfig(env), /Invalid configuration/);
  const error = new CircuitOpenError(130000);
  const body = safeFailure('lta', error).body;
  assert.equal(body.code, 'UPSTREAM_CIRCUIT_OPEN');
  const headers = providerFailureHeaders(error, 100001);
  assert.deepEqual(headers, { 'Cache-Control': 'no-store', 'Retry-After': '30' });
  const response = sendJson(undefined, providerFailureStatus(error), body, headers) as Response;
  assert.equal(response.status, 503); assert.equal(response.headers.get('Retry-After'), '30');
  const nodeHeaders: Record<string, string> = {};
  const res = { setHeader(k: string, v: string) { nodeHeaders[k] = v; }, status(value: number) { assert.equal(value, 503); return this; }, json(value: unknown) { assert.deepEqual(value, body); } };
  sendJson(res, providerFailureStatus(error), body, headers);
  assert.equal(nodeHeaders['Cache-Control'], 'no-store');
});

test('production-wired health and camera fallback respect the same circuits; partial feeds remain available', async () => {
  // Entirely synthetic transports; never fetch real camera metadata or signed links.
  const original = globalThis.fetch, log = console.error;
  const calls: string[] = [];
  console.error = () => undefined;
  const trip = async (url: string) => {
    for (let i = 0; i < config.server.circuit.failureThreshold; i++) await assert.rejects(withProviderCircuit(url, fail));
  };
  globalThis.fetch = async input => {
    calls.push(String(input));
    if (String(input) === config.trafficImagesUrl)
      return Response.json({ items: [{ timestamp: '2026-10-23T09:00:00+08:00', cameras: [] }] });
    if (String(input) === config.server.upstreams.pm25)
      return Response.json({ code: 0, data: { items: [{ timestamp: '2026-10-23T09:00:00+08:00', readings: {} }] } });
    throw new Error('unexpected synthetic transport');
  };
  try {
    await trip(config.server.upstreams.images);
    const health = await probe(config.server.upstreams.images);
    assert.equal(health.status, 'DOWN'); assert.equal(health.httpCode, 503); assert.equal(calls.length, 0);
    const response = await cameras(new Request('https://example.test/api/trafficimages', { headers: { AccountKey: 'synthetic-only' } })) as Response;
    assert.equal(response.status, 200);
    assert.deepEqual(calls, [config.trafficImagesUrl]);
    await trip(config.trafficImagesUrl);
    const failed = await cameras(new Request('https://example.test/api/trafficimages')) as Response;
    assert.equal(failed.status, 503);
    assert.equal((await failed.json()).code, 'UPSTREAM_CIRCUIT_OPEN');
    assert.equal(failed.headers.get('Cache-Control'), 'no-store');
    assert.ok(Number(failed.headers.get('Retry-After')) > 0);
    await trip(config.server.upstreams.psi);
    const partial = await airquality(new Request('https://example.test/api/airquality')) as Response;
    assert.equal(partial.status, 200); assert.equal(partial.headers.get('Cache-Control'), 'no-store');
    await trip(config.server.upstreams.pm25);
    const unavailable = await airquality(new Request('https://example.test/api/airquality')) as Response;
    assert.equal(unavailable.status, 503); assert.equal(unavailable.headers.get('Cache-Control'), 'no-store');
    assert.ok(Number(unavailable.headers.get('Retry-After')) > 0);
  } finally { globalThis.fetch = original; console.error = log; }
});
