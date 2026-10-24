import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpeedResource, isSpeedPayload } from '../src/features/traffic/speedResource.ts';
import type { SpeedPayload } from '../shared/traffic/types.ts';
import { createSpeedAccumulator } from '../server/traffic/aggregateSpeeds.ts';
import { traceCheckpoint, CHECKPOINT_ROUTES } from '../server/traffic/traceCheckpoint.ts';
import { inBoothZone } from '../shared/traffic/rules.ts';
import { normalizeCameraFeed } from '../src/features/cameras/normalizeCameraFeed.ts';
import { cameraLevel } from '../src/features/cameras/cameraReadings.ts';
import { getResolvedCameraUrl } from '../src/features/cameras/images.ts';
import { buildVmsBoards, groupByMessage } from '../src/features/cameras/vmsBoards.ts';
import { summarizeCommute } from '../src/features/commutes/summarizeCommute.ts';
import { fetchCameras } from '../src/features/cameras/cameraClient.ts';
import { getSpeedSummary } from '../server/traffic/speedService.ts';
import { config } from '../config/server.ts';

const payload = (full = false): SpeedPayload => ({
  success: true,
  source: 'fixture',
  lastUpdatedTime: '2026-10-19T09:00:00+08:00',
  generatedAt: '2026-10-19T01:00:00Z',
  pagesFetched: 1,
  totalLinks: 1,
  checkpoints: [],
  expressways: [{ code: 'BKE', avgSpeedKmH: 80, linkCount: 1, slowLinkPct: 0, status: 'Smooth', bandCounts: { 8: 1 } }],
  ...(full
    ? { segments: [['BKE', 8, 103.77, 1.4, 103.77, 1.41] as [string, number, number, number, number, number]] }
    : {}),
});
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function harness() {
  const calls: string[] = [],
    timers = new Map<number, () => void>();
  let now = 1000,
    saves = 0,
    refreshListener: (() => void) | undefined;
  let reply = async (url: string) => ({ data: payload(url.includes('segments')), offline: false, receivedAt: now });
  const resource = createSpeedResource({
    fetch: (url) => {
      calls.push(url);
      return reply(url);
    },
    load: () => ({ json: payload(true) }),
    save: () => {
      saves++;
    },
    now: () => now,
    pollMs: 100,
    retryMs: 10,
    schedule: (fn) => {
      const id = Math.random();
      timers.set(id, fn);
      return () => {
        timers.delete(id);
      };
    },
    onRefresh: (fn) => {
      assert.equal(refreshListener, undefined);
      refreshListener = fn;
      return () => {
        refreshListener = undefined;
      };
    },
  });
  return {
    resource,
    calls,
    timers,
    setReply: (fn: typeof reply) => {
      reply = fn;
    },
    advance: (ms: number) => {
      now += ms;
    },
    refresh: () => refreshListener?.(),
    saves: () => saves,
    hasListener: () => !!refreshListener,
  };
}

test('speed subscribers share one full request, one timer and one refresh listener', async () => {
  const h = harness();
  const stopA = h.resource.connect(() => {}, 'summary');
  const stopB = h.resource.connect(() => {}, 'full');
  const stopC = h.resource.connect(() => {}, 'geometry');
  await tick();
  assert.deepEqual(h.calls, ['/api/expresswayspeeds?include=segments']);
  assert.equal(h.timers.size, 1);
  h.refresh();
  h.refresh();
  await tick();
  assert.equal(h.calls.length, 2);
  stopA();
  stopB();
  assert.equal(h.timers.size, 0); // geometry remains without polling
  stopC();
  assert.equal(h.hasListener(), false);
});

test('summary consumers avoid geometry and a late full consumer upgrades serially', async () => {
  const h = harness();
  let release!: () => void;
  h.setReply(
    (url) =>
      new Promise((resolve) => {
        release = () => resolve({ data: payload(url.includes('segments')), offline: false, receivedAt: 1000 });
      }),
  );
  const a = h.resource.connect(() => {}, 'summary');
  await tick();
  assert.deepEqual(h.calls, ['/api/expresswayspeeds']);
  const b = h.resource.connect(() => {}, 'full');
  await tick();
  assert.equal(h.calls.length, 1);
  release();
  await tick();
  assert.equal(h.calls[1], '/api/expresswayspeeds?include=segments');
  release();
  await tick();
  assert.equal(h.resource.getSnapshot().data?.segments?.length, 1);
  a();
  b();
});

test('failed or offline speed refresh keeps honest status and never renews offline storage age', async () => {
  const h = harness();
  const stop = h.resource.connect(() => {}, 'full');
  await tick();
  const original = h.resource.getSnapshot().data;
  h.setReply(async () => {
    throw new Error('fixture unavailable');
  });
  await h.resource.refresh();
  assert.equal(h.resource.getSnapshot().data, original);
  assert.equal(h.resource.getSnapshot().status, 'error');
  assert.equal(h.resource.getSnapshot().refreshing, false);
  h.setReply(async () => ({ data: payload(true), offline: true, receivedAt: 20 }));
  await h.resource.refresh();
  assert.equal(h.resource.getSnapshot().fetchedAt, 20);
  assert.equal(h.resource.getSnapshot().fromSnapshot, true);
  assert.equal(h.saves(), 1);
  stop();
});

test('saved speeds are validated on initial failure and disposal clears scheduled work', async () => {
  const h = harness();
  h.setReply(async () => {
    throw new Error('offline');
  });
  const stop = h.resource.connect(() => {}, 'full');
  await tick();
  assert.equal(h.resource.getSnapshot().fromSnapshot, true);
  assert.equal(h.resource.getSnapshot().geometry.length, 1);
  stop();
  assert.equal(h.timers.size, 0);
  assert.equal(isSpeedPayload({ ...payload(), expressways: [{ code: 'BKE', avgSpeedKmH: NaN }] }), false);
  assert.equal(isSpeedPayload({ ...payload(), segments: [['BKE', 9, 0, 0, 0, 0]] }), false);
});

test('a request finishing after the last speed consumer leaves does not restart polling', async () => {
  const h = harness();
  let release!: () => void;
  h.setReply(
    () =>
      new Promise((resolve) => {
        release = () => resolve({ data: payload(true), offline: false, receivedAt: 1000 });
      }),
  );
  const stop = h.resource.connect(() => {}, 'full');
  await tick();
  stop();
  release();
  await tick();
  assert.equal(h.timers.size, 0);
  assert.equal(h.hasListener(), false);
  assert.equal(h.resource.getSnapshot().refreshing, false);
});

test('a newer summary retains VMS geometry without relabelling old segment speeds as current', async () => {
  const h = harness();
  const full = h.resource.connect(() => {}, 'full');
  await tick();
  const summary = h.resource.connect(() => {}, 'summary');
  full();
  h.setReply(async () => ({
    data: { ...payload(), lastUpdatedTime: '2026-10-19T09:05:00+08:00' },
    offline: false,
    receivedAt: 1100,
  }));
  await h.resource.refresh();
  assert.equal(h.resource.getSnapshot().data?.segments, undefined);
  assert.equal(h.resource.getSnapshot().geometry.length, 1);
  summary();
});

test('pure speed aggregation preserves band counts, arithmetic average and geometry filtering', () => {
  const a = createSpeedAccumulator();
  a.add([
    {
      RoadName: 'BUKIT TIMAH EXPRESSWAY',
      RoadCategory: '1',
      SpeedBand: 1,
      StartLon: 103.77,
      StartLat: 1.4,
      EndLon: 103.77,
      EndLat: 1.41,
    },
    {
      RoadName: 'BUKIT TIMAH EXPRESSWAY',
      RoadCategory: '1',
      SpeedBand: 8,
      StartLon: 103.77,
      StartLat: 1.41,
      EndLon: 103.77,
      EndLat: 1.42,
    },
    {
      RoadName: 'PAN ISLAND EXPRESSWAY',
      RoadCategory: '1',
      SpeedBand: 8,
      StartLon: 0,
      StartLat: 0,
      EndLon: 0,
      EndLat: 0,
    },
  ]);
  const { payload: data, segments } = a.finish(1, 3, '2026-10-19T09:00:00+08:00');
  assert.deepEqual(data.expressways[0], {
    code: 'BKE',
    avgSpeedKmH: 43,
    linkCount: 2,
    slowLinkPct: 50,
    status: 'Congested',
    bandCounts: { 1: 1, 8: 1 },
  });
  assert.equal(segments.length, 2);
  assert.equal(data.checkpoints.length, 1);
});

test('checkpoint tracing excludes booths and rejects a route with insufficient readings', () => {
  const route = CHECKPOINT_ROUTES[0];
  assert.equal(inBoothZone(1.348, 103.636), true);
  assert.equal(
    traceCheckpoint(route, [
      [103.77, 1.4, 103.77, 1.41, 0],
      [103.77, 1.41, 103.77, 1.42, 8],
    ]),
    null,
  );
  assert.equal(traceCheckpoint(CHECKPOINT_ROUTES[1], [[103.637, 1.348, 103.635, 1.348, 1]]), null);
  const traced = traceCheckpoint(route, [
    [103.77, 1.4, 103.77, 1.41, 8],
    [103.77, 1.41, 103.77, 1.42, 8],
  ]);
  assert.equal(traced?.queueSpeedKmH, 80);
  assert.equal(traced?.minutes, 2);
});

test('normalized camera readings prefer nearby speed and only use counts for the current photo', () => {
  const cam = normalizeCameraFeed(
    [{ camera_id: '2701', image: 'https://example.test/current.jpg', location: { latitude: 1.44, longitude: 103.77 } }],
    '2026-10-19T01:00:00Z',
  )[0];
  assert.equal(cam.place, 'woodlands');
  assert.equal(cam.capturedAt, '2026-10-19T01:00:00Z');
  assert.equal(
    cameraLevel(cam, null, { [cam.id]: { count: 70, imageUrl: 'https://example.test/previous.jpg' } }),
    null,
  );
  const counts = { [cam.id]: { count: 70, imageUrl: getResolvedCameraUrl(cam.imageUrl) } };
  assert.equal(cameraLevel(cam, null, counts)?.level, 'Massive jam');
  assert.equal(cameraLevel(cam, { speedKmH: 80, level: 'Smooth' }, counts)?.level, 'Smooth');
});

test('camera client preserves the public fallback and offline provenance of internal responses', async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  try {
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      return calls.length === 1
        ? new Response(null, { status: 502 })
        : Response.json({
            items: [
              {
                timestamp: '2026-10-19T01:00:00Z',
                cameras: [
                  {
                    camera_id: '2701',
                    image: 'https://example.test/photo.jpg',
                    location: { latitude: 1.44, longitude: 103.77 },
                  },
                ],
              },
            ],
          });
    };
    const fallback = await fetchCameras();
    assert.equal(calls.length, 2);
    assert.equal(fallback.source, 'Data.gov.sg Traffic Images');
    assert.equal(fallback.offline, false);
    assert.equal(fallback.cameras[0].place, 'woodlands');
    globalThis.fetch = async () =>
      Response.json(
        {
          success: true,
          totalCameras: 1,
          source: 'lta_datamall_v2',
          timestamp: '2026-10-19T01:00:00Z',
          cameras: [
            {
              camera_id: '2701',
              image: 'https://example.test/photo.jpg',
              latitude: 1.44,
              longitude: 103.77,
              timestamp: '2026-10-19T01:00:00Z',
            },
          ],
        },
        { headers: { 'X-TrafficPulse-Offline': '1' } },
      );
    assert.equal((await fetchCameras()).offline, true);
  } finally {
    globalThis.fetch = original;
  }
});

test('server speed service coalesces full aggregations and preserves metadata in the completed cache', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async (url) => {
      calls++;
      await tick();
      const skip = Number(new URL(String(url)).searchParams.get('$skip'));
      return Response.json({
        lastUpdatedTime: '2026-10-19T09:00:00+08:00',
        value: skip
          ? []
          : [
              {
                RoadName: 'PAN ISLAND EXPRESSWAY',
                RoadCategory: '1',
                SpeedBand: 8,
                StartLon: 103.8,
                StartLat: 1.3,
                EndLon: 103.81,
                EndLat: 1.3,
              },
            ],
      });
    };
    const [a, b] = await Promise.all([getSpeedSummary('synthetic-only'), getSpeedSummary('synthetic-only')]);
    assert.equal(a.payload, b.payload);
    assert.equal(a.segments, b.segments);
    assert.equal(a.expiresAt, b.expiresAt);
    assert.equal(calls, config.server.speeds.concurrency);
    assert.equal(a.payload.lastUpdatedTime, '2026-10-19T09:00:00+08:00');
    assert.equal(a.segments.length, 1);
    await getSpeedSummary('synthetic-only');
    assert.equal(calls, config.server.speeds.concurrency);
  } finally {
    globalThis.fetch = original;
  }
});

test('VMS keeps all distinct messages, severity order, blank filtering and every gantry location', () => {
  const signs = Array.from({ length: 9 }, (_, i) => ({
    EquipmentID: `g${i}`,
    Latitude: 1.4,
    Longitude: 103.77,
    Message: `Message ${i}`,
  }));
  signs.push(
    { ...signs[0], EquipmentID: 'repeat' },
    { ...signs[0], EquipmentID: 'critical', Message: 'ACCIDENT,AVOID LANE 1' },
    { ...signs[0], EquipmentID: 'blank', Message: ', ,' },
  );
  assert.equal(groupByMessage(signs).length, 10);
  const boards = buildVmsBoards(
    signs,
    payload(true).segments!,
    [{ name: 'Fixture Area', lat: 1.4, lon: 103.77, forecast: 'Fair' }],
    '09:00 SGT',
  );
  assert.equal(boards[0].status, 'CRITICAL');
  assert.deepEqual(boards[0].lines, ['ACCIDENT', 'AVOID LANE 1']);
  assert.equal(boards.find((b) => b.id === 'Message 0')?.locations.length, 2);
  assert.equal(boards[0].locations[0].code, 'BKE');
  assert.equal(boards[0].locations[0].area, 'Fixture Area');
});

test('commute summary preserves estimates, missing-leg totals and deduplicated floods', () => {
  const commute = {
    id: 'fixture',
    name: 'Fixture commute',
    alerts: false,
    legs: [
      { code: 'KPE', direction: 0, from: '', to: '' },
      { code: 'MCE', direction: 0, from: '', to: '' },
    ],
  };
  const input = {
    routes: [],
    estimateMinutes: (code: string) => (code === 'KPE' ? 12 : 5),
    incidents: [],
    roadWorks: {},
    rain: {},
    lightning: {},
    floods: {},
  };
  const summary = summarizeCommute(commute, input);
  assert.equal(summary.total, 17);
  assert.equal(summary.anyEstimated, true);
  assert.equal(summarizeCommute(commute, { ...input, estimateMinutes: () => null }).total, null);
});
