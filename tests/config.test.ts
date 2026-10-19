import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createConfig, createPublicConfig, ENV_KEYS, ENV_SCHEMA, environmentExample } from '../config/schema.ts';
import { fetchLtaAll, getLtaAccountKey } from '../api/_client.ts';
import cameraHandler from '../api/trafficimages.ts';

test('configuration defaults preserve current operational behavior and are immutable', () => {
  const c = createConfig();
  assert.equal(c.dev.port, 3100);
  assert.equal(c.dev.disableHmr, false);
  assert.equal(c.server.accountKey, null);
  assert.equal(c.server.upstreams.images, 'https://datamall2.mytransport.sg/ltaodataservice/Traffic-Imagesv2');
  assert.equal(c.server.upstreams.lightning, 'https://api-open.data.gov.sg/v2/real-time/api/weather?api=lightning');
  assert.equal(c.server.speeds.concurrency, 10);
  assert.equal(c.poll.cameras, 30000);
  assert.deepEqual(c.server.cache.speeds, [300, 600]);
  assert.ok(Object.isFrozen(c.server.speeds));
  assert.throws(() => { c.poll.cameras = 1; }, TypeError);
});

test('overrides are typed, provider paths derived, cache profiles scaled and aliases consistent', () => {
  const c = createConfig({ LTA_ACCOUNT_KEY: ' primary-test ', LTA_API_KEY: 'old-test', DEV_PORT: '3200', DISABLE_HMR: 'false',
    LTA_BASE_URL: 'http://127.0.0.1:4500/lta/', DATA_GOV_BASE_URL: 'https://weather.example.test/v2/',
    CDN_CACHE_MULTIPLIER: '0.5', SPEED_CACHE_TTL_MS: '600000', VITE_CAMERA_POLL_MS: '45000', VITE_VEHICLE_COUNTING_ENABLED: 'false' });
  assert.equal(c.server.accountKey, 'primary-test');
  assert.equal(createConfig({ LTA_API_KEY: ' legacy-test ' }).server.accountKey, 'legacy-test');
  assert.equal(c.server.upstreams.incidents, 'http://127.0.0.1:4500/lta/TrafficIncidents');
  assert.equal(c.server.upstreams.rain, 'https://weather.example.test/v2/two-hr-forecast');
  assert.equal(c.dev.port, 3200);
  assert.equal(c.dev.disableHmr, false);
  assert.equal(c.vehicleCountingEnabled, false);
  assert.equal(c.poll.cameras, 45000);
  assert.deepEqual(c.server.cache.speeds, [300, 600]);
  assert.deepEqual(createConfig({ CDN_CACHE_MULTIPLIER: '0' }).server.cache.weather, [0, 0]);
});

test('invalid settings fail with setting names and no supplied values', () => {
  for (const env of [
    { DEV_PORT: '0' }, { DEV_PORT: '3100garbage' }, { SPEED_PAGE_CONCURRENCY: '11' },
    { SPEED_MAX_PAGES: '5' }, { REQUEST_TIMEOUT_MS: '-1' }, { VITE_LIVE_POLL_MS: '1.5' },
    { DISABLE_HMR: '0' }, { VITE_VEHICLE_COUNTING_ENABLED: 'TRUE' }, { CDN_CACHE_MULTIPLIER: 'NaN' },
    { VITE_HEALTH_TIMEOUT_MS: '8000' }, { DEV_HOST: '0.0.0.0; command' }, { DEV_HOST: 'localhost:3200' },
    { HEALTHCHECK_RETRY_DELAY_MS: '120000', HEALTHCHECK_TIMEOUT_MS: '120000' },
    { LTA_BASE_URL: 'http://untrusted.example.test' }, { LTA_BASE_URL: 'https://user:private-marker@example.test' },
    { VITE_SITE_URL: 'https://example.test/subpath' }, { API_CORS_ORIGIN: 'https://a.test,https://b.test' },
    { VITE_LTA_ACCOUNT_KEY: 'private-marker' }, { LTA_ACCOUNT_KEY: 'YOUR_API_KEY' },
  ]) {
    assert.throws(() => createConfig(env), (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /Invalid configuration/);
      assert.ok(!err.message.includes('private-marker'));
      return true;
    });
  }
});

test('browser projection ignores private environment settings and contains no server config', () => {
  const c = createPublicConfig({ LTA_ACCOUNT_KEY: 'server-secret-marker', LTA_BASE_URL: 'bad-private-url',
    VITE_CAMERA_POLL_MS: '45000', VITE_VERCEL_ENV: 'preview' });
  assert.equal(c.poll.cameras, 45000);
  assert.ok(!('server' in c));
  assert.ok(!('dev' in c));
  assert.ok(!JSON.stringify(c).includes('server-secret-marker'));
  assert.ok(!JSON.stringify(c).includes('bad-private-url'));
});

test('checked-in environment example exactly matches schema and is safe without credentials', async () => {
  const checkedIn = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
  assert.equal(checkedIn, environmentExample());
  const entries = [...checkedIn.matchAll(/^([A-Z][A-Z0-9_]*)=(.*)$/gm)].map((m) => [m[1], m[2]]);
  assert.deepEqual(entries.map(([key]) => key).sort(), [...ENV_KEYS].sort());
  assert.equal(createConfig(Object.fromEntries(entries)).server.accountKey, null);
  assert.ok(ENV_KEYS.filter((key) => key.startsWith('VITE_')).every((key) => ENV_SCHEMA[key].scope === 'public'));
  assert.ok(!checkedIn.includes('GEMINI_API_KEY'));
});

test('LTA page cap refuses partial results and does not over-fetch the last wave', async () => {
  const original = globalThis.fetch;
  let count = 0;
  globalThis.fetch = async () => { count++; return Response.json({ value: Array(500).fill({}) }); };
  try {
    await assert.rejects(fetchLtaAll('https://example.test', 'fake-key', { wave: 2, maxPages: 3 }), /partial result/);
    assert.equal(count, 3);
  } finally { globalThis.fetch = original; }
});

test('camera handler uses the shared key resolver, configured timeout and keyless fallback', async () => {
  const original = globalThis.fetch;
  const calls: { url: string; key: unknown; signal: unknown }[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), key: (init?.headers as Record<string, string>)?.AccountKey, signal: init?.signal });
    return calls.length === 1 ? new Response('', { status: 500 }) : Response.json({ items: [{ timestamp: '2026-10-19T12:00:00+08:00', cameras: [] }] });
  };
  try {
    const request = { headers: { 'x-lta-account-key': 'header-test-key' } };
    const expectedKey = getLtaAccountKey(request);
    const response = await cameraHandler(request) as Response;
    assert.equal(response.status, 200);
    assert.equal(calls[0].key, expectedKey);
    assert.ok(calls[0].signal instanceof AbortSignal);
    assert.equal((await response.json()).source, 'data_gov_sg_lta_live');
    assert.ok(!calls[1].key);
  } finally { globalThis.fetch = original; }
});
