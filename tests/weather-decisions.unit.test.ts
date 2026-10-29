import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rainLevel, nearestArea, rainByExpressway, describeCorridorRain } from '../src/utils/rainForecast.ts';
import { saveSpeedSnapshot, loadSpeedSnapshot } from '../src/utils/speedSnapshot.ts';
import { config } from '../config/client.ts';
import { installDom } from './helpers/dom.ts';

const area = (name: string, forecast: string, lat = 1.3, lon = 103.8) => ({ name, forecast, lat, lon });

test('rain classification respects thunder/heavy precedence and does not mistake wind for rain', () => {
  for (const [forecast, expected] of [
    ['Fair (Night)', 'dry'], ['Heavy Winds', 'dry'], ['Passing Showers', 'rain'], ['Drizzle', 'rain'],
    ['HEAVY RAIN', 'heavy'], ['Heavy Showers', 'heavy'], ['Heavy Thundery Showers with Gusty Winds', 'thundery'],
  ]) assert.equal(rainLevel(forecast), expected, forecast);
});

test('nearest forecast area uses geography, handles no observations and resolves equal distances consistently', () => {
  assert.equal(nearestArea(1.3, 103.8, []), null);
  const nearby = area('Nearby', 'Fair', 1.3, 103.801), distant = area('Distant', 'Rain', 1.4, 103.8);
  assert.equal(nearestArea(1.3, 103.8, [distant, nearby]), nearby);
  assert.equal(nearestArea(1.3, 103.8, [nearby, { ...nearby, name: 'Tie' }]), nearby);
});

test('corridor outlook uses only observed associated areas, orders severity and describes partial coverage honestly', () => {
  const input = [area('City', 'Showers'), area('Marine Parade', 'Thundery Showers'), area('Bedok', 'Heavy Rain'),
    area('Tampines', 'Fair'), area('Woodlands', 'Fair'), area('Unmapped place', 'Thunderstorm')];
  const original = structuredClone(input), rain = rainByExpressway(input);
  assert.equal(rain.ECP.level, 'thundery'); assert.equal(rain.ECP.areaCount, 4);
  assert.deepEqual(rain.ECP.wetAreas.map(a => a.name), ['Marine Parade', 'Bedok', 'City']);
  assert.equal(describeCorridorRain(rain.ECP), 'Thundery Showers: Marine Parade, Bedok +1 (3 of 4 areas)');
  assert.equal(describeCorridorRain(rain.SLE), 'No rain expected (1 area)');
  assert.equal(rain.KJE, undefined); assert.deepEqual(rainByExpressway([]), {}); assert.deepEqual(input, original);
});

test('offline speed snapshot rounds geometry without mutating its source, expires at the configured boundary and tolerates blocked storage', () => {
  const dom = installDom(), before = Date.now, now = Date.parse('2026-10-29T01:00:00Z');
  Date.now = () => now;
  try {
    const data = { expressways: [{ code: 'PIE', avgSpeedKmH: 55 }], segments: [['PIE', 6, 103.81234567, 1.31234567, 103.82345678, 1.32345678]] };
    const original = structuredClone(data); saveSpeedSnapshot(data);
    const cached = loadSpeedSnapshot(now)!; assert.equal(cached.savedAt, now);
    assert.deepEqual(cached.json.segments[0], ['PIE', 6, 103.81235, 1.31235, 103.82346, 1.32346]);
    assert.deepEqual(cached.json.expressways, data.expressways); assert.deepEqual(data, original);
    assert.ok(loadSpeedSnapshot(now + config.freshness.speedSnapshot));
    assert.equal(loadSpeedSnapshot(now + config.freshness.speedSnapshot + 1), null);
    saveSpeedSnapshot({ expressways: [] }); assert.equal(loadSpeedSnapshot(now)!.json.segments, undefined);
    for (const invalid of ['{', 'null', '{"savedAt":"bad","json":{}}', '{"savedAt":1}']) {
      localStorage.setItem('trafficpulse.lastSpeeds', invalid); assert.equal(loadSpeedSnapshot(now), null);
    }
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      getItem() { throw new Error('synthetic-storage-blocked'); }, setItem() { throw new Error('synthetic-storage-full'); },
    } });
    assert.doesNotThrow(() => saveSpeedSnapshot(data)); assert.equal(loadSpeedSnapshot(now), null);
  } finally { Date.now = before; dom.restore(); }
});
