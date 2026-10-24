import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeFailure, reportFailure, UpstreamHttpError } from '../shared/diagnostics.ts';
import { createApiMiddleware } from '../server/apiMiddleware.ts';
import { healthReport, HEALTH_FEEDS } from '../scripts/health-report.ts';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Synthetic only: tests never load .env.local or call a provider.
const secret = 'audit-only-fixture/with+symbols=';
process.env.LTA_ACCOUNT_KEY = secret;
process.env.LTA_MAX_ATTEMPTS = '1';
process.env.DATA_GOV_MIN_INTERVAL_MS = '0';
process.env.DATA_GOV_RETRY_DELAY_MS = '0';
process.env.SPEED_MAX_ATTEMPTS = '1';
process.env.SPEED_PAGE_CONCURRENCY = '1';
process.env.SPEED_MAX_PAGES = '1';
const { handleLtaRequest } = await import('../api/_client.ts');
const routes = await Promise.all([
  ['rain', '../api/rainforecast.ts'], ['forecast', '../api/_forecast24h.ts'],
  ['air', '../api/airquality.ts'], ['carparks', '../api/_carparks.ts'],
  ['roads', '../api/_roadconditions.ts'], ['weather', '../api/_weatheralerts.ts'],
  ['floods', '../api/_floods.ts'], ['speeds', '../api/expresswayspeeds.ts'],
  ['cameras', '../api/trafficimages.ts'], ['proxy', '../api/imageproxy.ts'],
].map(async ([name, path]) => [name, (await import(path)).default] as const));
const health = (await import('../api/health.ts')).default;

function hostileError() {
  const error = Object.assign(new Error(`Authorization: Bearer ${secret}`), {
    headers: { AccountKey: secret }, cause: { token: secret },
    url: `https://example.invalid/?token=${encodeURIComponent(secret)}`,
    toJSON() { throw new Error('Raw errors must never be serialized'); },
  });
  error.stack = secret;
  return error;
}
function nodeResponse() {
  return {
    statusCode: 200, body: undefined as any, headers: {} as Record<string, string>,
    setHeader(key: string, value: string) { this.headers[key.toLowerCase()] = value; },
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
}
async function capture(run: (logs: string[]) => Promise<void>) {
  const originalFetch = globalThis.fetch;
  const originalLog = console.error;
  const logs: string[] = [];
  console.error = (...args) => { logs.push(JSON.stringify(args)); };
  try { await run(logs); } finally { globalThis.fetch = originalFetch; console.error = originalLog; }
}
function absent(value: unknown) {
  const output = JSON.stringify(value);
  for (const needle of [secret, encodeURIComponent(secret), 'Bearer', 'example.invalid', 'AccountKey'])
    assert.ok(!output.includes(needle), 'Untrusted diagnostics were disclosed');
}

test('safe diagnostics omit unknown fields and preserve only validated classifications', () => {
  absent(safeFailure(secret, hostileError(), NaN));
  assert.deepEqual(safeFailure(secret, hostileError()).log,
    { event: 'upstream_failure', service: 'gateway', code: 'UPSTREAM_FAILURE' });
  assert.equal(safeFailure('nea', Object.assign(hostileError(), { name: 'TimeoutError' })).body.code, 'UPSTREAM_TIMEOUT');
  assert.equal(safeFailure('nea', Object.assign(hostileError(), { name: 'AbortError' })).body.code, 'UPSTREAM_TIMEOUT');
  assert.equal(safeFailure('lta', new UpstreamHttpError(429)).log.upstreamHttpCode, 429);
  for (const status of [-1, 99, 600, Infinity, 200.5]) assert.ok(!('upstreamHttpCode' in safeFailure('lta', undefined, status).log));
});

test('reportFailure emits one structured line without serializing the original exception', async () => {
  await capture(async (logs) => {
    const body = reportFailure('lta', hostileError());
    absent([body, logs]);
    assert.equal(logs.length, 1);
  });
});

for (const mode of ['web', 'node']) {
  test(`LTA ${mode} failures omit exception details, provider JSON and HTML; preserve statuses and no-store`, async () => {
    await capture(async (logs) => {
      for (const status of [0, 401, 403, 429, 500]) {
        globalThis.fetch = async () => {
          if (!status) throw hostileError();
          return new Response(status === 500 ? `<html>${secret}</html>` : JSON.stringify({ error: secret }),
            { status, headers: { 'content-type': status === 500 ? 'text/html' : 'application/json' } });
        };
        const req = { method: 'GET', headers: { accountkey: secret }, url: '/api/traffic' };
        const res = mode === 'node' ? nodeResponse() : undefined;
        const response = await handleLtaRequest('https://example.invalid/provider', req, res) as Response;
        const body = res ? res.body : await response.json();
        assert.equal(res ? res.statusCode : response.status, status || 502);
        assert.equal(res ? res.headers['cache-control'] : response.headers.get('cache-control'), 'no-store');
        absent([body, logs]);
      }
    });
  });

  test(`LTA ${mode} successful OData remains intact and a 200 error envelope is rejected`, async () => {
    await capture(async (logs) => {
      const payload = { value: [{ Message: 'Traffic advisory', EstTime: 8 }], lastUpdatedTime: '2026-10-19T14:00:00+08:00' };
      for (const malformed of [false, true]) {
        globalThis.fetch = async () => Response.json(malformed ? { error: secret } : payload);
        const res = mode === 'node' ? nodeResponse() : undefined;
        const response = await handleLtaRequest('https://example.invalid/provider', { method: 'GET', url: '/api/traffic', headers: {} }, res) as Response;
        const body = res ? res.body : await response.json();
        assert.equal(res ? res.statusCode : response.status, malformed ? 502 : 200);
        if (malformed) absent([body, logs]); else assert.deepEqual(body, payload);
      }
    });
  });

  test(`all feed handlers sanitize thrown errors in ${mode} responses and logs`, async () => {
    await capture(async (logs) => {
      globalThis.fetch = async () => { throw hostileError(); };
      for (const [name, handler] of routes) {
        const req = { method: 'GET', headers: {}, url: name === 'proxy' ? '/api/imageproxy?url=' + encodeURIComponent('https://images.data.gov.sg/test.jpg') : '/api/' + name };
        const res = mode === 'node' ? nodeResponse() : undefined;
        const response = await handler(req, res) as Response;
        const body = res ? res.body : await response.json();
        assert.equal(res ? res.statusCode : response.status, 502, name);
        assert.equal(res ? res.headers['cache-control'] : response.headers.get('cache-control'), 'no-store', name);
        absent([body, logs]);
      }
    });
  });
}

test('provider 200 errorMsg envelopes cannot escape through weather APIs', async () => {
  await capture(async (logs) => {
    globalThis.fetch = async () => Response.json({ code: 1, errorMsg: secret });
    for (const [name, handler] of routes.filter(([name]) => ['rain', 'forecast', 'air', 'weather', 'floods'].includes(name))) {
      const response = await handler({ method: 'GET', url: '/api/test' }) as Response;
      assert.equal(response.status, 502, name);
      absent([await response.json(), logs]);
    }
  });
});

test('successful camera links retain required signatures while diagnostics omit them', async () => {
  await capture(async (logs) => {
    const image = `https://images.data.gov.sg/test.jpg?signature=${encodeURIComponent(secret)}`;
    globalThis.fetch = async () => Response.json({ value: [{ CameraID: 2701, ImageLink: image, Latitude: 1.4, Longitude: 103.7 }] });
    const handler = routes.find(([name]) => name === 'cameras')![1];
    const response = await handler({ method: 'GET', url: '/api/test' }) as Response;
    assert.equal(response.status, 200);
    assert.equal((await response.json()).cameras[0].image, image);
    absent(logs);
  });
});

test('health probes expose fixed failures and status metrics, never raw provider errors', async () => {
  await capture(async (logs) => {
    globalThis.fetch = async () => { throw hostileError(); };
    const response = await health({ method: 'GET', url: '/api/health' }) as Response;
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.totalCount, 15);
    assert.equal(data.upCount, 1);
    assert.equal(data.ltaKeyConfigured, true);
    absent([data, logs]);
    assert.deepEqual(new Set(data.endpoints.map((e: any) => e.path)), new Set(HEALTH_FEEDS.map(([path]) => path)));
  });
});

test('browser health errors omit rejected fetch details and malformed response snippets', async () => {
  const { refreshApiHealth, getHealthSnapshot } = await import('../src/utils/apiHealth.ts');
  await capture(async () => {
    globalThis.fetch = async () => { throw hostileError(); };
    await refreshApiHealth();
    absent(getHealthSnapshot().error);
    globalThis.fetch = async () => new Response(secret);
    await refreshApiHealth();
    absent(getHealthSnapshot().error);
    globalThis.fetch = async () => new Response('', { status: 429 });
    await refreshApiHealth();
    assert.equal(getHealthSnapshot().error, 'HTTP 429');
  });
});

test('development and preview middleware sanitize loader and handler exceptions', async () => {
  await capture(async (logs) => {
    for (const failure of ['loader', 'handler']) {
      const middleware = createApiMiddleware({ '/api/test': async () => {
        if (failure === 'loader') throw hostileError();
        return { default: async () => { throw hostileError(); } };
      } });
      const res = { statusCode: 200, text: '', headers: {} as Record<string, string>,
        setHeader(key: string, value: string) { this.headers[key] = value; }, end(text: string) { this.text = text; } };
      await middleware({ url: '/api/test?token=' + secret }, res, () => { throw new Error('Unexpected fallthrough'); });
      assert.equal(res.statusCode, 500);
      assert.equal(res.headers['Cache-Control'], 'no-store');
      assert.equal(JSON.parse(res.text).error, 'Internal Server Error');
      absent([res.text, logs]);
    }
  });
});

function fixture(status = 'UP', httpCode = 200) {
  const endpoints = HEALTH_FEEDS.map(([path]) => ({ path, name: secret, status, httpCode, latencyMs: 4, error: secret }));
  return { endpoints, upCount: status === 'UP' ? endpoints.length : 0, totalCount: endpoints.length, operational: status === 'UP' };
}
test('CI reports use static labels and numbers, retaining rate-limit warning and failure behavior', () => {
  for (const status of [200, 429, 500]) {
    const report = healthReport(fixture(status === 200 ? 'UP' : 'DOWN', status), 200);
    absent(report);
    assert.equal(report.allUp, status === 200);
    assert.equal(report.failed, status === 500);
    if (status === 429) assert.ok(report.annotations.every((item) => item.level === 'warning'));
  }
  const bad = fixture(); bad.endpoints[0].path = secret as any;
  assert.equal(healthReport(bad, 200).failed, true);
  absent(healthReport(bad, 200));
  const duplicate = fixture(); duplicate.endpoints[0] = duplicate.endpoints[1];
  assert.equal(healthReport(duplicate, 200).failed, true);
  assert.equal(healthReport({ ...fixture(), upCount: 0 }, 200).failed, true);
  assert.equal(healthReport(fixture('UP', 500), 200).failed, true);
  assert.equal(healthReport({ error: secret }, 503).failed, true);
});

test('native Node CI command writes safe summaries, fails closed and retries 429', () => {
  const directory = mkdtempSync(join(tmpdir(), 'trafficpulse-health-report-'));
  try {
    const file = join(directory, 'response.json');
    const summary = join(directory, 'summary.md');
    for (const status of [200, 429, 500]) {
      writeFileSync(file, JSON.stringify(fixture(status === 200 ? 'UP' : 'DOWN', status)));
      for (const mode of ['--check', '--report']) {
        writeFileSync(summary, '');
        const run = spawnSync(process.execPath, ['scripts/health-report.ts', mode, file, '200'],
          { encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: summary } });
        assert.equal(run.status, mode === '--check' ? status === 200 ? 0 : 1 : status === 500 ? 1 : 0);
        absent([run.stdout, run.stderr, readFileSync(summary, 'utf8')]);
      }
    }
    writeFileSync(file, secret);
    const invalid = spawnSync(process.execPath, ['scripts/health-report.ts', '--report', file, secret], { encoding: 'utf8' });
    assert.equal(invalid.status, 1);
    absent([invalid.stdout, invalid.stderr]);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
