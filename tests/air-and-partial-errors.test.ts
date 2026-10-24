import { test } from 'node:test';
import assert from 'node:assert/strict';
import { airNotices, airStatusText, airObservationTime, type AirQualityFeed } from '../src/features/weather/airFreshness.ts';
import { createPolledResource } from '../src/features/feeds/polledResource.ts';
import { config as publicConfig } from '../config/client.ts';
import type { AirQuality } from '../src/utils/airQuality.ts';
import { isAirQuality } from '../src/utils/airQuality.ts';
import { cameraAir } from '../src/features/cameras/cameraReadings.ts';
import type { CameraCard } from '../src/features/cameras/types.ts';
import { reportSourceFailure } from '../shared/diagnostics.ts';

const now = Date.parse('2026-10-23T04:00:00Z');
const observed = new Date(now - 60000).toISOString();
function data(): AirQuality {
  return { psiTimestamp: observed, pm25Timestamp: observed,
    regions: [{ name: 'north', lat: 1.44, lon: 103.77, psi24h: 30, pm25OneHour: 10, pm25TwentyFourHour: 10 }] };
}
function feed(changes: Partial<AirQualityFeed> = {}): AirQualityFeed {
  return { data: data(), status: 'live', offline: false, fetchedAt: now - 500, refreshing: false, ...changes };
}

test('air states distinguish loading, initial outage, retained failures, offline copies and healthy recovery', () => {
  assert.match(airStatusText(feed({ data: null, status: 'loading' }), now)!, /Loading/);
  assert.match(airStatusText(feed({ data: null, status: 'error' }), now)!, /unavailable/);
  assert.match(airStatusText(feed({ status: 'error' }), now)!, /refresh failed.*last received/);
  assert.match(airStatusText(feed({ status: 'error', offline: true }), now)!, /offline copy/);
  assert.equal(airStatusText(feed(), now), null);
  assert.deepEqual(airNotices(feed(), now), []);
});

test('PSI and PM2.5 observation age and missing sources are checked independently at the exact stale boundary', () => {
  const old = new Date(now - publicConfig.freshness.air).toISOString();
  for (const [field, label] of [['psiTimestamp', 'NEA PSI'], ['pm25Timestamp', 'NEA PM2.5']] as const) {
    const state = feed({ data: { ...data(), [field]: old } });
    assert.deepEqual(airNotices(state, now).map(n => n.label), [label]);
    assert.match(airNotices(state, now)[0].detail, /outdated/);
    const partial = feed({ data: { ...data(), [field]: null } });
    assert.deepEqual(airNotices(partial, now).map(n => n.label), [label]);
    assert.match(airStatusText(partial, now)!, /unavailable/);
  }
  const noReadings = data(); noReadings.regions[0].pm25OneHour = null;
  assert.match(airStatusText(feed({ data: noReadings }), now)!, /NEA PM2.5: unavailable/);
  assert.equal(airObservationTime('2026-10-23T04:00:00Z'), '12:00 SGT');
  assert.equal(airObservationTime(null), 'unavailable');
});

test('shared air resource failure and offline fallback preserve original receipt and observations; recovery clears warning', async () => {
  let failure = false, offline = false, clock = now, calls = 0;
  const resource = createPolledResource({ url: '/api/airquality', pollMs: 10000, isValid: isAirQuality }, {
    now: () => clock, retryMs: 1000, schedule: () => () => {}, onRefresh: () => () => {},
    fetch: async () => {
      calls++; if (failure) throw new Error('synthetic failure');
      return { data: data(), offline, receivedAt: offline ? now - 600000 : clock };
    },
  });
  await resource.refresh();
  const original = resource.getSnapshot();
  failure = true; clock += 1000; await resource.refresh();
  assert.equal(resource.getSnapshot().status, 'error');
  assert.equal(resource.getSnapshot().fetchedAt, original.fetchedAt);
  assert.equal(resource.getSnapshot().data, original.data);
  assert.match(airStatusText(resource.getSnapshot(), clock)!, /refresh failed/);
  failure = false; offline = true; await resource.refresh();
  assert.equal(resource.getSnapshot().fetchedAt, original.fetchedAt);
  assert.equal(resource.getSnapshot().data, original.data, 'offline copy must not replace the known network reading');
  offline = false; clock += 1000; await resource.refresh();
  assert.equal(resource.getSnapshot().status, 'live');
  assert.equal(airStatusText(resource.getSnapshot(), clock), null);
  assert.equal(calls, 4);
});

test('camera air details use separate observation times and never invent a missing metric timestamp', () => {
  const cam = { lat: 1.44, lon: 103.77 } as CameraCard;
  const air = { ...data(), pm25Timestamp: '2026-10-23T03:30:00Z' };
  const details = cameraAir(cam, air)!.detail;
  assert.match(details, /11:59 SGT/); assert.match(details, /11:30 SGT/);
  assert.equal(cameraAir(cam, { ...air, psiTimestamp: null }), null);
  assert.doesNotMatch(cameraAir(cam, { ...air, pm25Timestamp: null })!.detail, /PM2.5/);
});

// Dynamic server imports follow synthetic env setup. No .env.local or live provider is used.
process.env.LTA_ACCOUNT_KEY = 'synthetic-partial-only';
process.env.LTA_MAX_ATTEMPTS = '1';
process.env.LTA_PAGE_CONCURRENCY = '1';
process.env.LTA_MAX_PAGES = '1';
process.env.DATA_GOV_MIN_INTERVAL_MS = '0';
const { default: airHandler } = await import('../api/airquality.ts');
const { default: weatherHandler } = await import('../api/_weatheralerts.ts');
const { default: roadsHandler } = await import('../api/_roadconditions.ts');
const { config } = await import('../config/server.ts');
const { ltaSnapshots } = await import('../server/cache/ltaSnapshots.ts');
const u = config.server.upstreams;
const marker = 'synthetic-private-provider-marker';
const cases = [
  { name: 'airquality', handler: airHandler, url: '/api/airquality', source: ['psi', 'pm25'], urls: [u.psi, u.pm25],
    good: () => ({ code: 0, data: { regionMetadata: [], items: [{ timestamp: observed, readings: {} }] } }),
    partial: (body: any, i: number) => assert.equal(body[i === 0 ? 'psiTimestamp' : 'pm25Timestamp'], null) },
  { name: 'weather', handler: weatherHandler, url: '/api/live?feed=weatheralerts', source: ['lightning', 'wbgt'], urls: [u.lightning, u.wbgt],
    good: () => ({ code: 0, data: { records: [{ datetime: observed, item: { readings: [] } }] } }),
    partial: (body: any, i: number) => assert.equal(body[i === 0 ? 'strikes' : 'heatStations'], null) },
  { name: 'roads', handler: roadsHandler, url: '/api/live?feed=roadconditions', source: ['roadworks', 'faulty_lights'], urls: [u.roadWorks, u.faultyLights],
    good: () => ({ value: [] }),
    partial: (body: any, i: number) => assert.equal(body[i === 0 ? 'roadWorks' : 'faultyLights'], null) },
];
const nodeResponse = () => ({ statusCode: 0, body: undefined as any, headers: {} as Record<string, string>,
  setHeader(name: string, value: string) { this.headers[name.toLowerCase()] = value; },
  status(code: number) { this.statusCode = code; return this; }, json(body: unknown) { this.body = body; return this; } });

for (const mode of ['web', 'node']) {
  test(`${mode} partial failures emit one fixed diagnostic for the failed source, retain usable 200/no-store and avoid duplicate all-failed events`, async () => {
    const originalFetch = globalThis.fetch, originalLog = console.error;
    let logs: any[] = [];
    console.error = value => logs.push(JSON.parse(value));
    try {
      for (const example of cases) {
        for (const failed of [0, 1, 2]) {
          logs = [];
          // Independent outage scenarios start cold; a warm success is covered in caching integration tests.
          ltaSnapshots.clear();
          globalThis.fetch = async input => {
            const url = new URL(String(input)); url.searchParams.delete('$skip');
            const index = example.urls.indexOf(url.toString());
            if (failed === 2 || index === failed)
              throw Object.assign(new Error(marker), { stack: marker, headers: { secret: marker } });
            return Response.json(example.good());
          };
          const res = mode === 'node' ? nodeResponse() : undefined;
          const response = await example.handler(new Request('https://example.test' + example.url), res) as Response;
          const body = res ? res.body : await response.json();
          assert.equal(res ? res.statusCode : response.status, failed === 2 ? 502 : 200, example.name);
          assert.equal(res ? res.headers['cache-control'] : response.headers.get('cache-control'), 'no-store');
          assert.deepEqual(logs.map(log => log.source).sort(), (failed === 2 ? [...example.source] : [example.source[failed]]).sort());
          assert.ok(logs.every(log => log.event === 'upstream_failure'));
          assert.ok(!JSON.stringify([body, logs]).includes(marker));
          if (failed !== 2) example.partial(body, failed);
        }
      }
    } finally { globalThis.fetch = originalFetch; console.error = originalLog; }
  });
}

test('untrusted source classifications are omitted rather than reflected in diagnostics', () => {
  const original = console.error; const logs: string[] = [];
  console.error = value => logs.push(value);
  try { reportSourceFailure('nea', marker as 'psi', new Error(marker)); }
  finally { console.error = original; }
  assert.ok(!logs.join().includes(marker)); assert.ok(!('source' in JSON.parse(logs[0])));
});
