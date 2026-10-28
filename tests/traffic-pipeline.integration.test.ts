import { test } from 'node:test';
import assert from 'node:assert/strict';
// Provider fixtures only. Never load .env.local or request a real camera/provider.
process.env.LTA_ACCOUNT_KEY = 'synthetic-critical-path-key';
process.env.SPEED_PAGE_CONCURRENCY = '1'; process.env.SPEED_MAX_PAGES = '3'; process.env.SPEED_MAX_ATTEMPTS = '1'; process.env.LTA_MAX_ATTEMPTS = '1';
const speeds = (await import('../api/expresswayspeeds.ts')).default;
const imageproxy = (await import('../api/imageproxy.ts')).default;
const { invalidateSpeedSummary } = await import('../server/traffic/speedService.ts');
const { config } = await import('../config/server.ts');
const { getResolvedCameraUrl } = await import('../src/features/cameras/images.ts');
const link = (road = 'PAN ISLAND EXPRESSWAY', band = 8) => ({ RoadName: road, RoadCategory: '1', SpeedBand: band, StartLon: 103.8, StartLat: 1.3, EndLon: 103.81, EndLat: 1.31 });
const request = (path: string) => new Request('https://fixture.test' + path);

test('speed provider pages flow through aggregation and snapshot pagination without repeating the expensive fetch', async () => {
  const previous = globalThis.fetch, calls: number[] = []; invalidateSpeedSummary(process.env.LTA_ACCOUNT_KEY!);
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); assert.equal(url.origin + url.pathname, config.server.upstreams.speedBands);
    assert.equal(new Headers(init?.headers).get('AccountKey'), process.env.LTA_ACCOUNT_KEY);
    const skip = Number(url.searchParams.get('$skip')); calls.push(skip);
    return Response.json({ value: skip === 0 ? Array.from({ length: 500 }, () => link()) : Array.from({ length: 3 }, () => link('BUKIT TIMAH EXPRESSWAY', 1)), lastUpdatedTime: '2026-10-29T09:00:00+08:00' });
  };
  try {
    const first = await speeds(request('/api/expresswayspeeds?include=segments&collection=segments&limit=400')) as Response;
    const a = await first.json(); assert.equal(first.status, 200); assert.equal(a.segments.length, 400); assert.equal(a.pagination.total, 503);
    assert.deepEqual(calls, [0, 500]); assert.equal(first.headers.get('cache-control'), 'no-store');
    const next = await speeds(request('/api/expresswayspeeds?include=segments&collection=segments&limit=400&offset=400&snapshot=' + a.pagination.snapshot)) as Response;
    const b = await next.json(); assert.equal(b.segments.length, 103); assert.equal(b.pagination.nextOffset, null); assert.equal(b.pagination.snapshot, a.pagination.snapshot);
    const summary = await (await speeds(request('/api/expresswayspeeds')) as Response).json();
    assert.equal(summary.pagesFetched, 2); assert.equal(summary.totalLinks, 503);
    assert.deepEqual(summary.expressways.map((x: any) => [x.code, x.linkCount, x.avgSpeedKmH, x.status]), [['PIE', 500, 80, 'Smooth'], ['BKE', 3, 5, 'Congested']]);
    assert.deepEqual(calls, [0, 500]); assert.ok(!JSON.stringify([a, b, summary]).includes(process.env.LTA_ACCOUNT_KEY!));
  } finally { globalThis.fetch = previous; invalidateSpeedSummary(process.env.LTA_ACCOUNT_KEY!); }
});

test('speed page-cap failure cannot be cached as a complete dataset and a later healthy feed recovers', async () => {
  const previous = globalThis.fetch, error = console.error; let calls = 0, recovering = false;
  const events: string[] = []; console.error = value => { events.push(String(value)); }; invalidateSpeedSummary(process.env.LTA_ACCOUNT_KEY!);
  globalThis.fetch = async () => { calls++; return Response.json({ value: recovering ? [] : Array.from({ length: 500 }, () => link()) }); };
  try {
    const failed = await speeds(request('/api/expresswayspeeds')) as Response;
    const body = await failed.json(); assert.equal(failed.status, 502); assert.equal(body.success, false); assert.equal(calls, 3);
    assert.equal(failed.headers.get('cache-control'), 'no-store'); assert.ok(!JSON.stringify([body, events]).includes(process.env.LTA_ACCOUNT_KEY!));
    recovering = true;
    const healed = await speeds(request('/api/expresswayspeeds')) as Response;
    const next = await healed.json(); assert.equal(healed.status, 200); assert.deepEqual(next.expressways, []); assert.equal(calls, 4);
  } finally { globalThis.fetch = previous; console.error = error; invalidateSpeedSummary(process.env.LTA_ACCOUNT_KEY!); }
});

test('camera URL resolution through the binary proxy preserves signatures and pixels without forwarding caller credentials', async () => {
  const previous = globalThis.fetch;
  const source = 'https://images.data.gov.sg/photo.jpg?signature=synthetic%2Bsignature%2fbytes&expires=900';
  const jpeg = Uint8Array.from([255, 216, 255, 224, 1, 2, 3, 255, 217]); let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls++; assert.equal(String(input), source);
    const headers = new Headers(init?.headers);
    for (const name of ['cookie', 'authorization', 'accountkey']) assert.equal(headers.get(name), null);
    return new Response(jpeg, { headers: { 'Content-Type': 'application/octet-stream' } });
  };
  try {
    for (const transport of ['web', 'node-send', 'node-end']) {
      const req = new Request('https://fixture.test' + getResolvedCameraUrl(source), { headers: { Origin: config.siteUrl, Cookie: 'synthetic-private-cookie', Authorization: 'synthetic-private-authorization' } });
      let pixels: Buffer | undefined;
      const res = transport === 'web' ? undefined : { statusCode: 0, headers: {} as Record<string, string>,
        setHeader(k: string, v: string) { this.headers[k.toLowerCase()] = v; }, status(n: number) { this.statusCode = n; return this; },
        end(data: Buffer) { pixels = data; }, ...(transport === 'node-send' ? { send(data: Buffer) { pixels = data; } } : {}) };
      const response = await imageproxy(req, res) as Response;
      const headers = res ? res.headers : Object.fromEntries(response.headers);
      assert.equal(res ? res.statusCode : response.status, 200); assert.equal(headers['content-type'], 'image/jpeg');
      assert.equal(headers['access-control-allow-origin'], config.siteUrl); assert.match(headers['cache-control'], /public, max-age=/);
      assert.deepEqual(new Uint8Array(res ? pixels! : await response.arrayBuffer()), jpeg);
    }
    assert.equal(calls, 3);
  } finally { globalThis.fetch = previous; }
});
