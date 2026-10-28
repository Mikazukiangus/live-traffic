import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpeedAccumulator } from '../server/traffic/aggregateSpeeds.ts';
import { CHECKPOINT_ROUTES, traceCheckpoint, type RouteLink } from '../server/traffic/traceCheckpoint.ts';
import { cameraLevel, cameraRain, checkpointReadings } from '../src/features/cameras/cameraReadings.ts';
import { normalizeCameraFeed } from '../src/features/cameras/normalizeCameraFeed.ts';
import { getResolvedCameraUrl } from '../src/features/cameras/images.ts';
import { radarMarkers, radarNearYou } from '../src/features/radar/radarSelectors.ts';
import type { RadarSources } from '../src/features/radar/useRadarSources.ts';

const camera = normalizeCameraFeed([{ camera_id: '2701', image: 'https://images.data.gov.sg/current.jpg', latitude: 1.44, longitude: 103.77 }], '2026-10-29T01:00:00Z')[0];
const row = (band: number) => ({ RoadName: 'PAN ISLAND EXPRESSWAY', RoadCategory: '1', SpeedBand: band, StartLon: 103.8123456, StartLat: 1.3123456, EndLon: 103.8223456, EndLat: 1.3223456 });

test('speed aggregation changes congestion at exact 10%, 20% and 35% slow-link thresholds', () => {
  for (const [slow, status] of [[9, 'Smooth'], [10, 'Moderate'], [19, 'Moderate'], [20, 'Heavy'], [34, 'Heavy'], [35, 'Congested']] as const) {
    const accumulator = createSpeedAccumulator();
    accumulator.add(Array.from({ length: 100 }, (_, i) => row(i < slow ? 4 : 8)));
    const { payload, segments } = accumulator.finish(2, 100, '2026-10-29T09:00:00+08:00');
    const pie = payload.expressways[0];
    assert.equal(pie.status, status); assert.equal(pie.slowLinkPct, slow); assert.equal(pie.linkCount, 100);
    assert.equal(pie.avgSpeedKmH, Math.round((slow * 35 + (100 - slow) * 80) / 100));
    assert.equal(segments.length, 100); assert.deepEqual(segments[0].slice(2), [103.81235, 1.31235, 103.82235, 1.32235]);
  }
});

test('missing coordinates never become map geometry and invalid/unknown bands never become speed observations', () => {
  const accumulator = createSpeedAccumulator();
  accumulator.add([row(8), { ...row(1), StartLon: 0 }, row(0), row(9), { ...row(8), RoadName: 'Unknown road' }]);
  const { payload, segments } = accumulator.finish(1, 5);
  assert.equal(payload.totalLinks, 5); assert.equal(payload.expressways[0].linkCount, 2);
  assert.equal(payload.expressways[0].avgSpeedKmH, 43); assert.equal(segments.length, 1);
  assert.equal(payload.lastUpdatedTime, null);
  assert.deepEqual(createSpeedAccumulator().finish(0, 0).payload.expressways, []);
});

test('checkpoint tracing selects the mainline at a merge independently of input order', () => {
  const main: RouteLink = [103.77, 1.4, 103.77, 1.41, 8], end: RouteLink = [103.77, 1.41, 103.77, 1.42, 8];
  const ramp: RouteLink = [103.76, 1.405, 103.77, 1.41, 1];
  for (const links of [[ramp, end, main], [main, ramp, end], [end, main, ramp]]) {
    const answer = traceCheckpoint(CHECKPOINT_ROUTES[0], links)!;
    assert.equal(answer.km, 2.2); assert.equal(answer.minutes, 2); assert.equal(answer.queueSpeedKmH, 80);
    assert.ok(answer.minMinutes <= answer.minutes && answer.minutes <= answer.maxMinutes);
  }
});

test('checkpoint tracing rejects mostly unknown routes and terminates cycles without invalid time ranges', () => {
  const links: RouteLink[] = Array.from({ length: 10 }, (_, i) => [103.77, 1.3 + i / 1024, 103.77, 1.3 + (i + 1) / 1024, i < 4 ? 0 : 8]);
  assert.equal(traceCheckpoint(CHECKPOINT_ROUTES[0], links), null);
  links[3][4] = 8; links[2][4] = 8;
  const enough = traceCheckpoint(CHECKPOINT_ROUTES[0], links)!; assert.ok(enough);
  assert.ok(Number.isFinite(enough.minutes)); assert.equal(enough.queueSpeedKmH, 80);
  const loop: RouteLink[] = [[103.77, 1.4, 103.77, 1.41, 8], [103.77, 1.41, 103.77, 1.42, 8], [103.77, 1.42, 103.77, 1.4, 8]];
  const answer = traceCheckpoint(CHECKPOINT_ROUTES[0], loop)!;
  assert.ok(answer && Number.isFinite(answer.minutes)); assert.ok(answer.km < 5);
  assert.ok(answer.minMinutes <= answer.minutes && answer.minutes <= answer.maxMinutes);
});

test('camera count thresholds apply only to the matching current Causeway photo; live speeds take precedence', () => {
  for (const [count, level] of [[0, 'Smooth'], [29, 'Smooth'], [30, 'Busy'], [49, 'Busy'], [50, 'Jam'], [64, 'Jam'], [65, 'Massive jam']] as const) {
    const counts = { [camera.id]: { count, imageUrl: getResolvedCameraUrl(camera.imageUrl) } };
    assert.equal(cameraLevel(camera, null, counts)?.level, level);
    assert.equal(cameraLevel(camera, { speedKmH: 80, level: 'Smooth' }, counts)?.detail, '80 km/h');
    assert.equal(cameraLevel({ ...camera, imageUrl: 'https://images.data.gov.sg/new.jpg' }, null, counts), null);
  }
  assert.equal(cameraLevel({ ...camera, id: 'lta-live-4703' }, null, { 'lta-live-4703': { count: 70, imageUrl: getResolvedCameraUrl(camera.imageUrl) } }), null);
});

test('checkpoint summary preserves zero counts, chooses the correct travel direction and leaves missing readings unknown', () => {
  const counts = { [camera.id]: { count: 0, imageUrl: getResolvedCameraUrl(camera.imageUrl) } };
  const routes = [1, 2].map(direction => ({ code: 'BKE', direction, towards: 'Woodlands', stretches: [{ from: 'BKE/PIE Interchange', to: 'Woodlands Centre', minutes: direction === 1 ? 7 : 99 }] }));
  const readings = checkpointReadings([camera], counts, {}, routes, cam => cameraLevel(cam, null, counts));
  assert.equal(readings[0].count, 0); assert.equal(readings[0].ltaMinutes, 7); assert.equal(readings[0].reading?.level, 'Smooth');
  assert.equal(readings[0].queue, null); assert.equal(readings[1].count, null); assert.equal(readings[1].reading, null); assert.equal(readings[1].ltaMinutes, null);
  assert.equal(cameraRain(camera, null), null);
});

test('radar layers hide disabled hazards and preserve only incidents with map coordinates', () => {
  const sources = { weatherAlerts: { data: { strikes: [{ lat: 1.3, lon: 103.8 }] } }, floodAlerts: [] } as unknown as RadarSources;
  const incident = { id: 'incident', type: 'Accident', severity: 'Critical', location: 'PIE', corridorCode: 'PIE', lat: 1.3, lon: 103.8 };
  const feed = { incidents: [incident, { ...incident, id: 'unmapped', lat: null }] } as any;
  assert.deepEqual(radarMarkers({ incidents: false, floods: false, lightning: false }, sources, feed), []);
  const markers = radarMarkers({ incidents: true, floods: false, lightning: true }, sources, feed);
  assert.deepEqual(markers.map(marker => marker.kind), ['lightning', 'critical']);
  const empty = { rainForecast: null, airQuality: null, speedSegments: [] } as unknown as RadarSources;
  assert.equal(radarNearYou(empty, { status: 'idle' }, Date.now()), null);
  const near = radarNearYou(empty, { status: 'found', lat: 1.3, lon: 103.8 }, Date.now())!;
  assert.equal(near.road, null); assert.equal(near.erp, null);
});
