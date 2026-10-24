import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DATA_GOV_MIN_INTERVAL_MS = '0';
process.env.DATA_GOV_RETRY_DELAY_MS = '0';
const air = await import('../api/airquality.ts'), forecast = await import('../api/_forecast24h.ts'), alerts = await import('../api/_weatheralerts.ts');
const { config } = await import('../config/server.ts');
const { probeDataGov } = await import('../server/healthProbes.ts');
const u = config.server.upstreams;
const clear = () => { air.invalidateResultCache(); forecast.invalidateResultCache(); alerts.invalidateResultCache(); };
function fixture(url: string, at: number, validFor = 86400000) {
  const timestamp = new Date(at).toISOString();
  if ([u.psi, u.pm25].includes(url)) return { regionMetadata: [], items: [{ timestamp, readings: {} }] };
  if (url === u.forecast24h) return { records: [{ timestamp, updatedTimestamp: timestamp, general: {
    validPeriod: { start: timestamp, end: new Date(at + validFor).toISOString() }, forecast: { text: 'Fair' },
    temperature: { low: 25, high: 32 }, relativeHumidity: { low: 60, high: 90 }, wind: { direction: 'N', speed: { low: 1, high: 10 } },
  }, periods: Array.from({ length: 3 }, (_, i) => ({ timePeriod: { text: String(i), start: timestamp, end: new Date(at + validFor).toISOString() }, regions: {} })) }] };
  return { records: [{ datetime: timestamp, item: { readings: Array.from({ length: 3 }, (_, i) => ({
    location: { latitude: 1.3, longitude: 103.8 }, datetime: timestamp, station: { id: String(i), name: 'Fixture' }, wbgt: 25, heatStress: 'Low',
  })) } }] };
}
const feeds = [
  { module: air, path: '/api/airquality', collection: 'regions', sources: [u.psi, u.pm25], ttl: 300000 },
  { module: forecast, path: '/api/forecast24h', collection: 'periods', sources: [u.forecast24h], ttl: 900000 },
  { module: alerts, path: '/api/live?feed=weatheralerts', collection: 'strikes', sources: [u.lightning, u.wbgt], ttl: 60000 },
];
async function invoke(feed: typeof feeds[number], node: boolean, query = '') {
  const res = node ? { statusCode: 0, body: undefined as any, headers: {} as Record<string, string>,
    setHeader(k: string, v: string) { this.headers[k.toLowerCase()] = v; }, status(n: number) { this.statusCode = n; return this; }, json(body: any) { this.body = body; return this; } } : undefined;
  const request = new Request('https://example.test' + feed.path + (query ? (feed.path.includes('?') ? '&' : '?') + query : ''));
  const result = await feed.module.default(request, res) as Response;
  return { status: res ? res.statusCode : result.status, body: res ? res.body : await result.json(), headers: res ? res.headers : Object.fromEntries(result.headers) };
}
for (const node of [false, true]) test(`${node ? 'Node' : 'Web'} weather pagination reuses one normalized build across concurrent/sequential requests and later offsets`, async () => {
  const original = globalThis.fetch; const at = Date.now(), calls = new Map<string, number>(); clear();
  globalThis.fetch = async input => { const url = String(input); calls.set(url, (calls.get(url) ?? 0) + 1); return Response.json({ code: 0, data: fixture(url, at) }); };
  try {
    for (const feed of feeds) {
      const first = await Promise.all(Array.from({ length: 20 }, () => invoke(feed, node, `limit=2&collection=${feed.collection}`)));
      assert.ok(first.every(r => r.status === 200));
      for (const source of feed.sources) assert.equal(calls.get(source), 1, source === u.psi ? 'PSI' : feed.collection);
      const page = first[0].body.pagination;
      const next = await invoke(feed, node, `limit=2&collection=${feed.collection}&offset=2&snapshot=${page.snapshot}`);
      assert.equal(next.status, 200); assert.equal(next.body.pagination.snapshot, page.snapshot);
      assert.equal(next.headers['cache-control'], 'no-store');
      for (const source of feed.sources) assert.equal(calls.get(source), 1);
      feed.module.invalidateResultCache(); feed.sources.forEach(source => calls.delete(source));
      for (let n = 0; n < 20; n++) assert.equal((await invoke(feed, node, `limit=2&collection=${feed.collection}`)).status, 200);
      for (const source of feed.sources) assert.equal(calls.get(source), 1, '20 sequential pages share one source build');
    }
  } finally { globalThis.fetch = original; clear(); }
});

test('each weather result expires at its TTL, keeps original source timestamps and caps CDN freshness at the remaining age', async () => {
  const fetch = globalThis.fetch, clock = Date.now; let now = clock(); const calls = new Map<string, number>();
  Date.now = () => now; clear();
  globalThis.fetch = async input => { const url = String(input); calls.set(url, (calls.get(url) ?? 0) + 1); return Response.json({ code: 0, data: fixture(url, now) }); };
  try {
    for (const feed of feeds) {
      clear(); calls.clear(); const first = await invoke(feed, false);
      const observed = first.body.psiTimestamp ?? first.body.issuedAt ?? first.body.lightningAt;
      now += feed.ttl - 1000; const hit = await invoke(feed, false);
      assert.equal(hit.body.psiTimestamp ?? hit.body.issuedAt ?? hit.body.lightningAt, observed);
      assert.equal(hit.headers['vercel-cdn-cache-control'], 'max-age=1, stale-while-revalidate=0');
      assert.ok(feed.sources.every(source => calls.get(source) === 1));
      now += 1000; await invoke(feed, false); assert.ok(feed.sources.every(source => calls.get(source) === 2));
      feed.module.invalidateResultCache(); await invoke(feed, false); assert.ok(feed.sources.every(source => calls.get(source) === 3));
    }
  } finally { globalThis.fetch = fetch; Date.now = clock; clear(); }
});

test('published 24-hour validity cuts a fifteen-minute cache short and the next request obtains a new issue', async () => {
  const fetch = globalThis.fetch, clock = Date.now; let now = clock(), calls = 0;
  Date.now = () => now; clear(); globalThis.fetch = async input => { calls++; return Response.json({ code: 0, data: fixture(String(input), now, 10000) }); };
  try {
    const first = await invoke(feeds[1], false); assert.equal(first.headers['vercel-cdn-cache-control'], 'max-age=10, stale-while-revalidate=0');
    now += 9999; await invoke(feeds[1], false); assert.equal(calls, 1);
    now++; const next = await invoke(feeds[1], false); assert.equal(calls, 2); assert.notEqual(next.body.issuedAt, first.body.issuedAt);
  } finally { globalThis.fetch = fetch; Date.now = clock; clear(); }
});

test('partial weather and invalid-provider errors remain uncached; complete recovery can be reused', async () => {
  const fetch = globalThis.fetch, log = console.error; const at = Date.now(); let failed = true, calls = 0;
  clear(); console.error = () => undefined;
  globalThis.fetch = async input => { calls++; const url = String(input); return failed && [u.psi, u.lightning, u.forecast24h].includes(url)
    ? new Response('', { status: 400 }) : Response.json({ code: 0, data: fixture(url, at) }); };
  try {
    for (const feed of feeds) {
      clear(); failed = true; calls = 0;
      const a = await invoke(feed, false), b = await invoke(feed, false);
      assert.equal(calls, feed.sources.length * 2); assert.equal(a.headers['cache-control'], 'no-store'); assert.equal(b.headers['vercel-cdn-cache-control'], 'no-store');
      failed = false; assert.equal((await invoke(feed, false)).status, 200); const recovered = calls;
      await invoke(feed, false); assert.equal(calls, recovered);
    }
    clear(); calls = 0; globalThis.fetch = async () => { calls++; return Response.json({ code: 1, errorMsg: 'synthetic-private-marker' }); };
    for (let i = 0; i < 2; i++) assert.equal((await invoke(feeds[1], false)).status, 502);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = fetch; console.error = log; clear(); }
});

test('health probes bypass a fresh normalized success and still reveal a failing live provider', async () => {
  const fetch = globalThis.fetch; const at = Date.now(); let calls = 0, failed = false; clear();
  globalThis.fetch = async input => { calls++; return failed ? new Response('', { status: 400 }) : Response.json({ code: 0, data: fixture(String(input), at) }); };
  try {
    assert.equal((await invoke(feeds[0], false)).status, 200); assert.equal(calls, 2);
    failed = true; const probe = await probeDataGov(u.psi); assert.equal(probe.status, 'DOWN'); assert.equal(probe.httpCode, 400); assert.equal(calls, 3);
    assert.equal((await invoke(feeds[0], false)).status, 200); assert.equal(calls, 3, 'fresh app snapshot is independent of the uncached probe');
  } finally { globalThis.fetch = fetch; clear(); }
});
