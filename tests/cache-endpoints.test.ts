import { test } from 'node:test';
import assert from 'node:assert/strict';
// Synthetic credentials/transports only; never load .env.local or real camera data.
process.env.LTA_ACCOUNT_KEY = 'synthetic-cache-only';
process.env.LTA_MAX_ATTEMPTS = '1';
process.env.LTA_PAGE_CONCURRENCY = '1';
process.env.LTA_MAX_PAGES = '2';
const { default: carparks } = await import('../api/_carparks.ts');
const { default: roads } = await import('../api/_roadconditions.ts');
const { ltaSnapshots } = await import('../server/cache/ltaSnapshots.ts');
const { config } = await import('../config/server.ts');
const u = config.server.upstreams;
const request = (feed: string) => new Request('https://example.test/api/live?feed=' + feed);

test('car park responses preserve original fetchedAt and remaining CDN TTL across 20 warm reads', async () => {
  const fetch = globalThis.fetch, clock = Date.now;
  let now = Date.parse('2026-10-24T01:00:00Z'), calls = 0;
  Date.now = () => now; ltaSnapshots.clear();
  globalThis.fetch = async () => { calls++; return Response.json({ value: [] }); };
  try {
    const responses = await Promise.all(Array.from({ length: 20 }, () => carparks(request('carparks')) as Promise<Response>));
    const first = await responses[0].json();
    assert.equal(calls, 1); assert.equal(first.fetchedAt, new Date(now).toISOString());
    now += 59000;
    const hit = await carparks(request('carparks')) as Response;
    assert.equal((await hit.json()).fetchedAt, first.fetchedAt);
    assert.equal(hit.headers.get('Vercel-CDN-Cache-Control'), 'max-age=1, stale-while-revalidate=0');
    now += 1000;
    const fresh = await carparks(request('carparks')) as Response;
    assert.equal(calls, 2); assert.equal((await fresh.json()).fetchedAt, new Date(now).toISOString());
  } finally { globalThis.fetch = fetch; Date.now = clock; ltaSnapshots.clear(); }
});

test('cached roadworks re-filter at Singapore midnight and CDN cannot carry yesterday into today', async () => {
  const fetch = globalThis.fetch, clock = Date.now;
  let now = Date.parse('2026-10-24T23:59:59+08:00'), calls = 0;
  Date.now = () => now; ltaSnapshots.clear();
  globalThis.fetch = async input => {
    calls++;
    return Response.json({ value: String(input).startsWith(u.roadWorks) ? [
      { EventID: 'yesterday', RoadName: 'PAN ISLAND EXPRESSWAY', StartDate: '2026-10-24', EndDate: '2026-10-24' },
      { EventID: 'today', RoadName: 'PAN ISLAND EXPRESSWAY', StartDate: '2026-10-25', EndDate: '2026-10-25' },
    ] : [] });
  };
  try {
    const first = await roads(request('roadconditions')) as Response;
    assert.deepEqual((await first.json()).roadWorks.map((r: any) => r.id), ['yesterday']);
    assert.equal(first.headers.get('Vercel-CDN-Cache-Control'), 'max-age=1, stale-while-revalidate=0');
    now += 2000;
    const next = await roads(request('roadconditions')) as Response;
    const body = await next.json();
    assert.equal(body.date, '2026-10-25'); assert.deepEqual(body.roadWorks.map((r: any) => r.id), ['today']);
    assert.equal(calls, 2, 'same two source snapshots; date-based business filtering is not cached');
  } finally { globalThis.fetch = fetch; Date.now = clock; ltaSnapshots.clear(); }
});

test('partial road response retries only the failed source while keeping partial/failure responses uncached', async () => {
  const fetch = globalThis.fetch, log = console.error;
  let works = 0, lights = 0;
  ltaSnapshots.clear(); console.error = () => undefined;
  globalThis.fetch = async input => {
    if (String(input).startsWith(u.roadWorks)) { works++; return Response.json({ value: [] }); }
    lights++; return lights < 3 ? new Response('', { status: 400 }) : Response.json({ value: [] });
  };
  try {
    for (let n = 0; n < 3; n++) {
      const response = await roads(request('roadconditions')) as Response;
      const body = await response.json(); assert.equal(response.status, 200);
      assert.deepEqual(body.roadWorks, []);
      if (n < 2) { assert.equal(body.faultyLights, null); assert.equal(response.headers.get('Cache-Control'), 'no-store'); }
      else assert.deepEqual(body.faultyLights, []);
    }
    assert.equal(works, 1); assert.equal(lights, 3);
  } finally { globalThis.fetch = fetch; console.error = log; ltaSnapshots.clear(); }
});

test('malformed records and incomplete pages never poison future car park responses', async () => {
  const fetch = globalThis.fetch, log = console.error;
  let calls = 0;
  ltaSnapshots.clear(); console.error = () => undefined;
  globalThis.fetch = async () => { calls++; return Response.json({ value: calls === 1 ? [null] : [] }); };
  try {
    const bad = await carparks(request('carparks')) as Response;
    assert.equal(bad.status, 502); assert.equal(bad.headers.get('Cache-Control'), 'no-store');
    const good = await carparks(request('carparks')) as Response;
    assert.equal(good.status, 200); await carparks(request('carparks')); assert.equal(calls, 2);
    ltaSnapshots.clear();
    globalThis.fetch = async () => { calls++; return Response.json({ value: Array(500).fill({}) }); };
    const partial = await carparks(request('carparks')) as Response; assert.equal(partial.status, 502);
    globalThis.fetch = async () => { calls++; return Response.json({ value: [] }); };
    assert.equal((await carparks(request('carparks')) as Response).status, 200);
    assert.equal(calls, 5, 'two capped pages refused, next request reads a new complete dataset');
  } finally { globalThis.fetch = fetch; console.error = log; ltaSnapshots.clear(); }
});
