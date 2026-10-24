import { test } from 'node:test';
import assert from 'node:assert/strict';
// Fixtures only. No .env.local, real credentials, images or provider requests.
process.env.LTA_ACCOUNT_KEY = 'synthetic-pagination-only';
process.env.LTA_PAGE_CONCURRENCY = '1';
process.env.LTA_MAX_ATTEMPTS = '1';
process.env.SPEED_PAGE_CONCURRENCY = '1';
process.env.SPEED_MAX_ATTEMPTS = '1';
process.env.DATA_GOV_MIN_INTERVAL_MS = '0';
const names = ['traffic', 'trafficflow', 'traveltimes', 'vms', 'trafficimages', 'expresswayspeeds', 'rainforecast', '_forecast24h', 'airquality', 'live', '_carparks', '_roadconditions', '_weatheralerts', '_floods', 'health', 'imageproxy'];
const routes = Object.fromEntries(await Promise.all(names.map(async name => [name, (await import(`../api/${name}.ts`)).default])));
routes.forecast24h = routes._forecast24h;
const { config } = await import('../config/server.ts');
const { ltaSnapshots } = await import('../server/cache/ltaSnapshots.ts');
const { listQuery, requestSchemas } = await import('../server/http/requestSchemas.ts');
const { withListResponse } = await import('../server/http/listPagination.ts');
const u = config.server.upstreams, now = Date.now(), observed = new Date(now).toISOString();
const today = new Date(now + 8 * 3600000).toISOString().slice(0, 10);
const incidentRows = Array.from({ length: 7 }, (_, id) => ({ Type: 'Accident', Latitude: 1.3, Longitude: 103.8, Message: 'Fixture ' + id }));
function provider(input: any): Response {
  const url = new URL(String(input)), skip = Number(url.searchParams.get('$skip') ?? 0);
  const endpoint = url.origin + url.pathname;
  const value = (rows: any[]) => Response.json({ value: rows.slice(skip, skip + 500) });
  if ([u.incidents, u.speedBands, u.vms, u.travelTimes].includes(endpoint) && endpoint !== u.speedBands) return value(incidentRows);
  if (endpoint === u.speedBands) return value(['PAN ISLAND EXPRESSWAY', 'AYER RAJAH EXPRESSWAY', 'CENTRAL EXPRESSWAY'].map(RoadName => ({
    RoadName, RoadCategory: '1', SpeedBand: 8, StartLon: 103.8, StartLat: 1.3, EndLon: 103.81, EndLat: 1.31,
  })));
  if (endpoint === u.images) return value(Array.from({ length: 8 }, (_, i) => ({ CameraID: 2701 + i, Latitude: 1.4, Longitude: 103.7,
    ImageLink: `https://images.data.gov.sg/${2701 + i}_1120_20261024010000_FIXTURE.jpg?signature=synthetic-only` })));
  if (endpoint === u.carParks) return value(Array.from({ length: 7 }, (_, i) => ({ CarParkID: String(i), Agency: 'LTA', LotType: 'C', Location: '1.3 103.8', AvailableLots: i, Development: 'Car park ' + i })));
  if (endpoint === u.roadWorks) return value(Array.from({ length: 7 }, (_, i) => ({ EventID: i, RoadName: 'PAN ISLAND EXPRESSWAY', StartDate: today, EndDate: today })));
  if (endpoint === u.faultyLights) return value(Array.from({ length: 7 }, (_, i) => ({ AlarmID: i, Message: 'Flashing yellow ' + i, StartDate: observed })));
  const data = (body: any) => Response.json({ code: 0, data: body });
  if (String(input) === u.lightning) return data({ records: [{ datetime: observed, item: { readings: Array.from({ length: 7 }, () => ({ location: { latitude: 1.3, longtitude: 103.8 }, datetime: observed })) } }] });
  if (String(input) === u.wbgt) return data({ records: [{ datetime: observed, item: { readings: Array.from({ length: 7 }, (_, i) => ({ station: { id: String(i), name: 'Station' }, location: { latitude: 1.3, longitude: 103.8 }, wbgt: 25, heatStress: 'Low' })) } }] });
  if (endpoint === u.floods) return data({ records: [{ datetime: observed, item: { identifier: 'fixture-flood', msgType: 'Alert', readings: Array.from({ length: 7 }, () => ({ headline: 'Fixture flood', area: { areaDesc: 'City', circle: [1.3, 103.8, 1] } })) } }] });
  if (endpoint === u.rain) return data({ area_metadata: Array.from({ length: 7 }, (_, i) => ({ name: 'Area ' + i, label_location: { latitude: 1.3, longitude: 103.8 } })),
    items: [{ timestamp: observed, update_timestamp: observed, valid_period: { text: 'Next two hours', start: new Date(now - 60000).toISOString(), end: new Date(now + 3600000).toISOString() },
      forecasts: Array.from({ length: 7 }, (_, i) => ({ area: 'Area ' + i, forecast: 'Fair' })) }] });
  if (endpoint === u.forecast24h) return data({ records: [{ timestamp: observed, updatedTimestamp: observed,
    general: { validPeriod: { start: observed, end: new Date(now + 86400000).toISOString() }, forecast: { text: 'Fair' }, temperature: { low: 25, high: 32 }, relativeHumidity: { low: 60, high: 90 }, wind: { direction: 'N', speed: { low: 5, high: 10 } } },
    periods: Array.from({ length: 3 }, (_, i) => ({ timePeriod: { text: String(i), start: observed, end: new Date(now + 3600000).toISOString() }, regions: {} })) }] });
  if (endpoint === u.psi || endpoint === u.pm25) return data({ regionMetadata: [], items: [{ timestamp: observed, readings: { psi_twenty_four_hourly: {}, pm25_one_hourly: {} } }] });
  throw new Error('Unexpected synthetic provider');
}
function nodeResponse() { return { statusCode: 0, body: undefined as any, headers: {} as Record<string, string>,
  setHeader(k: string, v: string) { this.headers[k.toLowerCase()] = v; }, status(n: number) { this.statusCode = n; return this; },
  json(body: any) { this.body = body; return this; }, end() { return this; } }; }
async function invoke(name: string, search: string, node: boolean) {
  const res = node ? nodeResponse() : undefined;
  const r = await routes[name](new Request('https://example.test/api/' + name + search), res) as Response;
  return { status: res ? res.statusCode : r.status, body: res ? res.body : await r.json(), headers: res ? res.headers : Object.fromEntries(r.headers) };
}
const lists: [string, string, string][] = [
  ['trafficimages', '', 'cameras'], ['expresswayspeeds', '?include=segments', 'segments'],
  ['expresswayspeeds', '', 'expressways'], ['expresswayspeeds', '', 'checkpoints'], ['rainforecast', '', 'areas'],
  ['forecast24h', '', 'periods'], ['airquality', '', 'regions'],
  ['live', '?feed=forecast24h', 'periods'],
  ['live', '?feed=carparks', 'carParks'], ['live', '?feed=roadconditions', 'roadWorks'], ['live', '?feed=roadconditions', 'faultyLights'],
  ['live', '?feed=weatheralerts', 'strikes'], ['live', '?feed=weatheralerts', 'heatStations'], ['live', '?feed=floods', 'alerts'],
  ['_carparks', '', 'carParks'], ['_roadconditions', '', 'roadWorks'], ['_weatheralerts', '', 'heatStations'], ['_floods', '', 'alerts'],
];
const suffix = (base: string, query: string) => base + (base ? '&' : '?') + query;
for (const node of [false, true]) {
  test(`every normalized list supports safe opt-in paging through ${node ? 'Node' : 'Web'}, with complete-list compatibility`, async () => {
    const fetch = globalThis.fetch; globalThis.fetch = async input => provider(input); ltaSnapshots.clear();
    try {
      for (const [name, base, collection] of lists) {
        const legacy = await invoke(name, base, node); assert.equal(legacy.status, 200, name); assert.ok(!('pagination' in legacy.body));
        const first = await invoke(name, suffix(base, `collection=${collection}&limit=2`), node);
        assert.equal(first.status, 200, name + ':' + collection); assert.equal(first.headers['cache-control'], 'no-store');
        assert.equal(first.body.pagination.total, legacy.body[collection].length, name + ':' + collection);
        assert.deepEqual(first.body[collection], legacy.body[collection].slice(0, 2));
        if (first.body.pagination.hasMore) {
          const second = await invoke(name, suffix(base, `collection=${collection}&limit=2&offset=2&snapshot=${first.body.pagination.snapshot}`), node);
          assert.equal(second.status, 200, name + ':' + collection); assert.deepEqual(second.body[collection], legacy.body[collection].slice(2, 4));
        }
        if (collection === 'segments') { assert.ok(!('expressways' in first.body)); assert.ok(!('checkpoints' in first.body)); }
      }
    } finally { globalThis.fetch = fetch; ltaSnapshots.clear(); }
  });
  test(`native LTA ${node ? 'Node' : 'Web'} lists forward bounded offsets, keep legacy payloads and expose live/unknown totals`, async () => {
    const fetch = globalThis.fetch, calls: URL[] = [];
    globalThis.fetch = async input => { calls.push(new URL(String(input))); return provider(input); };
    try {
      for (const name of ['traffic', 'trafficflow', 'vms', 'traveltimes']) {
        const legacy = await invoke(name, '?$skip=0', node); assert.equal(legacy.status, 200); assert.ok(!('pagination' in legacy.body));
        const first = await invoke(name, '?limit=2&offset=0', node); assert.equal(first.status, 200); assert.equal(first.body.value.length, 2);
        assert.equal(calls.at(-1)!.searchParams.get('$skip'), '0'); assert.equal(calls.at(-1)!.searchParams.get('limit'), null);
        assert.equal(first.body.pagination.total, null); assert.equal(first.body.pagination.consistency, 'live');
        const second = await invoke(name, '?limit=2&offset=2', node); assert.equal(second.status, 200); assert.equal(calls.at(-1)!.searchParams.get('$skip'), '2');
      }
    } finally { globalThis.fetch = fetch; }
  });
  test(`all ${node ? 'Node' : 'Web'} pagination boundaries reject malformed controls before transport`, async () => {
    const fetch = globalThis.fetch, log = console.error; let calls = 0; const logs: any[] = [];
    globalThis.fetch = async () => { calls++; throw new Error('should not run'); }; console.error = x => logs.push(x);
    try {
      for (const [name, base, collection] of lists) for (const control of ['limit=0', 'limit=501', 'offset=-1', 'offset=1000001', 'limit=1&limit=2', 'cursor=synthetic-private-marker', 'snapshot=synthetic-private-marker', 'offset=2', 'collection=__proto__']) {
        const query = control.startsWith('collection=') ? control : `collection=${collection}&${control}`;
        const result = await invoke(name, suffix(base, query), node);
        assert.equal(result.status, 400, name + ':' + query); assert.equal(result.headers['cache-control'], 'no-store');
        assert.ok(!JSON.stringify(result.body).includes('synthetic-private-marker'));
      }
      assert.equal((await invoke('expresswayspeeds', '?collection=segments&limit=2', node)).status, 400);
      assert.equal((await invoke('live', '?feed=roadconditions&limit=2', node)).status, 400);
      for (const name of ['traffic', 'trafficflow', 'vms', 'traveltimes']) for (const q of ['?limit=0', '?limit=501', '?offset=-1', '?offset=1000001', '?offset=0&$skip=0', '?snapshot=' + 'a'.repeat(64)])
        assert.equal((await invoke(name, q, node)).status, 400, name + ':' + q);
      for (const name of ['health', 'imageproxy']) assert.equal((await invoke(name, '?limit=2', node)).status, 400);
      assert.equal(calls, 0); assert.deepEqual(logs, []);
    } finally { globalThis.fetch = fetch; console.error = log; }
  });
}

test('a failed selected collection returns 503 instead of a false empty page while the other source stays usable', async () => {
  const fetch = globalThis.fetch, log = console.error;
  globalThis.fetch = async input => String(input).startsWith(u.faultyLights) ? new Response('', { status: 400 }) : provider(input);
  console.error = () => undefined; ltaSnapshots.clear();
  try {
    const works = await invoke('live', '?feed=roadconditions&collection=roadWorks&limit=2', false);
    assert.equal(works.status, 200); assert.equal(works.body.roadWorks.length, 2); assert.ok(!('faultyLights' in works.body));
    const lights = await invoke('live', '?feed=roadconditions&collection=faultyLights&limit=2', false);
    assert.equal(lights.status, 503); assert.equal(lights.body.code, 'PAGINATION_COLLECTION_UNAVAILABLE');
    assert.equal(lights.headers['vercel-cdn-cache-control'], 'no-store');
  } finally { globalThis.fetch = fetch; console.error = log; ltaSnapshots.clear(); }
});

test('snapshot changes through the actual incident-independent camera list return safe conflicts without exposing tokens', async () => {
  const fetch = globalThis.fetch; let changed = false;
  globalThis.fetch = async input => {
    const response = provider(input);
    if (!changed || !String(input).startsWith(u.images)) return response;
    const body = await response.json(); body.value.reverse(); return Response.json(body);
  };
  try {
    const first = await invoke('trafficimages', '?limit=2', false); changed = true;
    const next = await invoke('trafficimages', '?limit=2&offset=2&snapshot=' + first.body.pagination.snapshot, false);
    assert.equal(next.status, 409); assert.ok(!JSON.stringify(next.body).includes(first.body.pagination.snapshot));
  } finally { globalThis.fetch = fetch; }
});
