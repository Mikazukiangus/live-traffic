import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { activeFloodAlerts } from '../api/_floods.ts';
import { unexpiredFloodAlerts } from '../src/utils/floodAlerts.ts';
import { mapLtaIncident, parseLtaMessage } from '../src/utils/ltaIncidents.ts';
import { describe, erpCalendar, erpOn } from '../src/utils/erp.ts';
import { ERP_EXPRESSWAY_GANTRIES } from '../src/data/erpRates.ts';
import { currentVehicleCount } from '../src/utils/vehicleDetection.ts';
import { describeExpresswaySpeed } from '../src/utils/expresswaySpeeds.ts';
import { recordSample, trendOf } from '../src/utils/commuteHistory.ts';
import { fetchFeed } from '../src/utils/feedResponse.ts';
import { getHealthSnapshot, isHealthData, refreshApiHealth } from '../src/utils/apiHealth.ts';

const at = (s: string) => Date.parse(s + '+08:00');

test('PUB cancellations work without area readings', () => {
  const records = [
    { datetime: '2026-10-10T08:00:00+08:00', item: { msgType: 'Alert', identifier: 'A', readings: [{ area: { circle: [1.3, 103.8, 0.5] } }] } },
    { datetime: '2026-10-10T08:10:00+08:00', item: { msgType: 'Cancel', references: 'PUB,A,2026-10-10T08:00:00+08:00', readings: [] } },
  ];
  assert.equal(activeFloodAlerts(records, at('2026-10-10T08:05:00')).length, 1);
  assert.equal(activeFloodAlerts(records, at('2026-10-10T08:15:00')).length, 0);
  delete (records[1].item as { readings?: unknown }).readings;
  assert.equal(activeFloodAlerts(records, at('2026-10-10T08:15:00')).length, 0);
});

test('cached flood alerts expire on the device, including the exact end time', () => {
  const alerts = activeFloodAlerts([{ datetime: '2026-10-10T08:00:00+08:00', item: { identifier: 'A', readings: [{ area: { circle: [1.3, 103.8, 0.5] } }] } }], at('2026-10-10T08:05:00'));
  assert.equal(unexpiredFloodAlerts(alerts, at('2026-10-10T07:59:00')).length, 0);
  assert.equal(unexpiredFloodAlerts(alerts, at('2026-10-10T08:15:00')).length, 1);
  assert.equal(unexpiredFloodAlerts(alerts, Date.parse(alerts[0].endsAt)).length, 0);
  assert.equal(unexpiredFloodAlerts([{ ...alerts[0], endsAt: 'invalid' }], at('2026-10-10T08:15:00')).length, 0);
});

test('Singapore New Year is parsed before the UTC year rolls over', () => {
  const now = new Date('2026-12-31T16:15:00Z');
  assert.equal(parseLtaMessage('(1/1)00:05 Accident on PIE.', now).reportedAt?.toISOString(), '2026-12-31T16:05:00.000Z');
  assert.equal(parseLtaMessage('(31/12)23:55 Accident on PIE.', now).reportedAt?.toISOString(), '2026-12-31T15:55:00.000Z');
});

test('incident identity survives insertions and reordering in the source feed', () => {
  const item = { Type: 'Road Works', Latitude: 1.35, Longitude: 103.73, Message: '(10/10)14:42 Road Works on PIE.' };
  assert.equal(mapLtaIncident(item, 0).id, mapLtaIncident(item, 12).id);
  assert.notEqual(mapLtaIncident(item, 0).id, mapLtaIncident({ ...item, Message: '(10/10)14:45 Road Works on PIE.' }, 0).id);
});

test('camera count cannot attach to a newer photo or another camera', () => {
  const counts = { cam1: { count: 42, imageUrl: '/api/imageproxy?url=old' } };
  assert.equal(currentVehicleCount(counts, 'cam1', '/api/imageproxy?url=old')?.count, 42);
  assert.equal(currentVehicleCount(counts, 'cam1', '/api/imageproxy?url=new'), undefined);
  assert.equal(currentVehicleCount(counts, 'cam2', '/api/imageproxy?url=old'), undefined);
});

test('retained speed is explicitly labelled after errors or age expiry', () => {
  const byCode = { CTE: { code: 'CTE', avgSpeedKmH: 57, status: 'Moderate' as const } };
  assert.match(describeExpresswaySpeed({ byCode, status: 'error' }, 'CTE'), /57 km.*refresh failed/);
  assert.match(describeExpresswaySpeed({ byCode, status: 'live', stale: true }, 'CTE'), /outdated/);
  assert.equal(describeExpresswaySpeed({ byCode, status: 'live' }, 'CTE'), '57 km/h • Moderate');
});

test('ERP holidays, substitute Mondays and designated eves use Singapore dates', () => {
  const check = (s: string) => erpOn(['CTE', 'AYE'], new Date(s + '+08:00'));
  assert.ok(check('2026-12-24T08:40:00').charging.length > 0);
  for (const s of ['2026-12-25T08:40:00', '2026-11-09T08:40:00', '2027-02-08T08:40:00', '2027-01-01T08:40:00']) {
    assert.equal(check(s).charging.length, 0, s);
    assert.equal(check(s).next, null, s);
  }
  for (const s of ['2026-12-24T13:00:00', '2026-12-24T18:00:00', '2026-12-31T18:00:00', '2026-03-20T18:00:00', '2027-03-09T18:00:00']) {
    assert.equal(check(s).charging.length, 0, s);
    assert.equal(check(s).next, null, s);
  }
  // Haji eve is an ordinary weekday under LTA's detailed operating-hours rule.
  assert.ok(check('2026-05-26T18:00:00').charging.length > 0);
  assert.ok(check('2026-12-23T18:00:00').charging.length > 0);
  const onlyEvening = { ...ERP_EXPRESSWAY_GANTRIES[0], weekdaySchedule: [['17:00', '18:00', 2] as [string, string, number]] };
  assert.equal(describe(onlyEvening, true, '08:00', erpCalendar(new Date('2026-12-24T00:00:00Z'))).note, 'no more charges today');
  const unknown = erpCalendar(new Date('2028-01-03T00:40:00Z'));
  assert.equal(unknown.known, false);
  assert.equal(describe(onlyEvening, true, '17:30', unknown).state, 'Unverified');
});

test('steady commute updates build history while duplicate update times do not', () => {
  const storage = new Map<string, string>();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) } });
  try {
    const start = at('2026-10-10T08:00:00');
    recordSample('commute', 20, start);
    recordSample('commute', 20, start);
    let samples = recordSample('commute', 20, start + 5 * 60_000);
    assert.equal(samples.length, 2);
    for (let minutes = 10; minutes <= 30; minutes += 5) samples = recordSample('commute', 20, start + minutes * 60_000);
    assert.equal(samples.length, 7);
    assert.equal(trendOf(samples, start + 30 * 60_000)?.direction, 'steady');
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

test('shared fetch distinguishes offline cache age, coalesces requests and rejects HTTP errors', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ value: [] }), { headers: { 'X-TrafficPulse-Offline': '1', 'X-TrafficPulse-Cached-At': '1000' } }); };
  try {
    const [a, b] = await Promise.all([fetchFeed('/cached-test'), fetchFeed('/cached-test')]);
    assert.equal(calls, 1);
    assert.deepEqual(a, b);
    assert.equal(a.offline, true);
    assert.equal(a.receivedAt, 1000);
    globalThis.fetch = async () => new Response('{}', { status: 502 });
    await assert.rejects(fetchFeed('/http-error-test'), /HTTP 502/);
  } finally { globalThis.fetch = original; }
});

test('health starts unverified, shares in-flight work and preserves errors after a successful check', async () => {
  const payload = { operational: true, ltaKeyConfigured: true, upCount: 1, totalCount: 1, timestamp: '2026-10-10T00:00:00Z', uptimeSeconds: 12, endpoints: [{ path: '/api/health', name: 'Health', status: 'UP', httpCode: 200, latencyMs: 0 }] };
  assert.equal(isHealthData({}), false);
  assert.equal(isHealthData({ ...payload, totalCount: 2 }), false);
  assert.equal(isHealthData({ ...payload, operational: false }), false);
  assert.equal(isHealthData(payload), true);
  assert.equal(getHealthSnapshot().data, null);
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json(payload); };
  try {
    await Promise.all([refreshApiHealth(), refreshApiHealth()]);
    assert.equal(calls, 1);
    assert.equal(getHealthSnapshot().data?.upCount, 1);
    assert.equal(getHealthSnapshot().checkedAt, Date.parse(payload.timestamp));
    globalThis.fetch = async () => new Response('{}', { status: 503 });
    await refreshApiHealth();
    assert.equal(getHealthSnapshot().error, 'HTTP 503');
    assert.equal(getHealthSnapshot().loading, false);
    assert.equal(getHealthSnapshot().data?.upCount, 1);
    globalThis.fetch = async () => Response.json({ nonsense: true });
    await refreshApiHealth();
    assert.match(getHealthSnapshot().error || '', /Unexpected/);
  } finally { globalThis.fetch = original; }
});

test('service worker marks offline API data and preserves its original saved time', async () => {
  const handlers: Record<string, (event: any) => void> = {};
  const saved = new Map<string, Response>();
  const key = (r: Request | string) => typeof r === 'string' ? r : r.url;
  let online = true;
  const context = {
    URL, Headers, Response, Date,
    self: { location: { origin: 'https://traffic.test' }, addEventListener: (name: string, fn: (event: any) => void) => { handlers[name] = fn; } },
    caches: { open: async () => ({ put: async (r: Request | string, response: Response) => { saved.set(key(r), response); } }), match: async (r: Request | string) => saved.get(key(r))?.clone() },
    fetch: async () => { if (!online) throw new Error('offline'); return Response.json({ alerts: [{ endsAt: '2026-10-10T08:00:00+08:00' }] }); },
  };
  runInNewContext(await readFile(new URL('../public/sw.js', import.meta.url), 'utf8'), context);
  const load = () => {
    let result: Promise<Response> | undefined;
    handlers.fetch({ request: new Request('https://traffic.test/api/live?feed=floods'), respondWith: (r: Promise<Response>) => { result = r; } });
    return result!;
  };
  assert.equal((await load()).headers.get('X-TrafficPulse-Offline'), null);
  const originalTime = saved.values().next().value!.headers.get('X-TrafficPulse-Cached-At');
  assert.ok(Number(originalTime) > 0);
  online = false;
  const offline = await load();
  assert.equal(offline.headers.get('X-TrafficPulse-Offline'), '1');
  assert.equal(offline.headers.get('X-TrafficPulse-Cached-At'), originalTime);
});
