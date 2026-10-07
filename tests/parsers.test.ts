/**
 * Checks for the parsers that turn LTA, NEA and PUB data into what the app shows, so a change in
 * their formats is caught before it reaches main. Run with `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTimeAgo, mapLtaIncident, parseLtaMessage, sortBySeverity, countByCorridor } from '../src/utils/ltaIncidents.ts';
import { parseSgt } from '../src/utils/freshness.ts';
import { groupStretches, minutesBetween, sumTravelTimes } from '../src/utils/ltaTravelTimes.ts';
import { describe, erpOn, singaporeNow } from '../src/utils/erp.ts';
import { ERP_EXPRESSWAY_GANTRIES } from '../src/data/erpRates.ts';
import { activeFloodAlerts } from '../api/_floods.ts';
import { trendOf } from '../src/utils/commuteHistory.ts';
import { kmBetween, nearestExpressway } from '../src/utils/nearMe.ts';
import { jamLevel } from '../src/utils/expresswaySpeeds.ts';

// Singapore is UTC+8: 2026-10-07 08:15 SGT
const MORNING = new Date('2026-10-07T00:15:00Z');

test('LTA incident message: expressway, direction, lane and time', () => {
  const p = parseLtaMessage('(7/10)08:05 Vehicle Breakdown on KJE (towards PIE) after PIE(Changi). Avoid lane 3.', MORNING);
  assert.equal(p.corridorCode, 'KJE');
  assert.equal(p.location, 'towards PIE, after PIE(Changi)');
  assert.equal(p.lane, 'Lane 3 affected');
  assert.equal(p.reportedAt?.toISOString(), '2026-10-07T00:05:00.000Z');
  assert.equal(formatTimeAgo(p.reportedAt, MORNING), '10 mins ago');
});

test('LTA incident message: full expressway names and several lanes', () => {
  const p = parseLtaMessage('(7/10)07:50 Accident on Kallang-Paya Lebar Expressway (towards ECP) at Tg Katong Rd Exit. Avoid lanes 1 and 2.', MORNING);
  assert.equal(p.corridorCode, 'KPE');
  assert.equal(p.lane, 'Lanes 1 and 2 affected');
});

test('LTA incident message: ordinary roads have no expressway', () => {
  const p = parseLtaMessage('(7/10)08:00 Roadworks on Orchard Road.', MORNING);
  assert.equal(p.corridorCode, undefined);
  assert.equal(p.location, 'Orchard Road');
});

test('LTA incident message: a December report read in January is last year', () => {
  const p = parseLtaMessage('(31/12)23:50 Accident on PIE (towards Changi Airport).', new Date('2027-01-01T00:30:00Z'));
  assert.equal(p.reportedAt?.getUTCFullYear(), 2026);
});

test('LTA incident record keeps its type, severity and position', () => {
  const inc = mapLtaIncident({ Type: 'Accident', Latitude: 1.33, Longitude: 103.8, Message: '(7/10)08:00 Accident on CTE (towards SLE).' }, 0, MORNING);
  assert.equal(inc.type, 'Accident');
  assert.equal(inc.severity, 'Critical');
  assert.equal(inc.corridorCode, 'CTE');
  assert.deepEqual([inc.lat, inc.lon], [1.33, 103.8]);
  const sorted = sortBySeverity([
    mapLtaIncident({ Type: 'Heavy Traffic', Message: 'Heavy Traffic on PIE.' }, 1, MORNING),
    inc,
  ]);
  assert.equal(sorted[0].type, 'Accident');
  assert.deepEqual(countByCorridor(sorted), { PIE: 1, CTE: 1 });
});

test('LTA/NEA timestamps without a zone are Singapore time', () => {
  assert.equal(parseSgt('2026-10-07 08:15:00'), Date.parse('2026-10-07T00:15:00Z'));
  assert.equal(parseSgt('2026-10-07T08:15:00+08:00'), Date.parse('2026-10-07T00:15:00Z'));
  assert.equal(parseSgt(''), null);
  assert.equal(parseSgt('not a time'), null);
});

const TRAVEL = [
  { Name: 'AYE', Direction: 1, FarEndPoint: 'TUAS CHECKPOINT', StartPoint: 'JURONG TOWN HALL RD', EndPoint: 'PENJURU RD', EstTime: 1 },
  { Name: 'AYE', Direction: 1, FarEndPoint: 'TUAS CHECKPOINT', StartPoint: 'PENJURU RD', EndPoint: 'AYE/PIE INTERCHANGE', EstTime: 4 },
  { Name: 'AYE', Direction: 1, FarEndPoint: 'TUAS CHECKPOINT', StartPoint: 'AYE/PIE INTERCHANGE', EndPoint: 'TUAS CHECKPOINT', EstTime: 3 },
  { Name: 'AYE', Direction: 2, FarEndPoint: 'CITY', StartPoint: 'TUAS CHECKPOINT', EndPoint: 'TUAS WEST RD', EstTime: 2 },
];

test('LTA travel times: stretches, place names and sums', () => {
  const routes = groupStretches(TRAVEL);
  assert.equal(routes.length, 2);
  assert.equal(routes[0].towards, 'Tuas Checkpoint');
  assert.equal(routes[0].stretches[1].to, 'AYE/PIE Interchange');
  assert.equal(minutesBetween(routes[0], 'Jurong Town Hall Rd', 'Tuas Checkpoint'), 8);
  assert.equal(minutesBetween(routes[0], 'penjuru rd', 'tuas checkpoint'), 7);
  assert.equal(minutesBetween(routes[0], 'Tuas Checkpoint', 'Penjuru Rd'), null);
  assert.deepEqual(sumTravelTimes(TRAVEL).AYE, [
    { towards: 'Tuas Checkpoint', minutes: 8 },
    { towards: 'City', minutes: 2 },
  ]);
});

test('ERP: charging, free, weekends and the next charge', () => {
  const cte = ERP_EXPRESSWAY_GANTRIES.find((g) => g.code === 'CTE' && g.gantryNos === '31, 33, 34')!;
  assert.equal(describe(cte, true, '08:40').state, 'Charging');
  assert.equal(describe(cte, true, '08:40').carRate, 5);
  assert.equal(describe(cte, true, '12:00').note, 'no more charges today');
  assert.equal(describe(cte, false, '08:40').state, 'Free now');
  assert.deepEqual(singaporeNow(MORNING), { weekday: 'Wed', isWeekday: true, hhmm: '08:15' });
  const atEight = erpOn(['CTE'], MORNING);
  assert.ok(atEight.charging.length > 0);
  assert.equal(atEight.next, null);
  const early = erpOn(['CTE'], new Date('2026-10-06T22:00:00Z')); // 06:00 SGT
  assert.equal(early.charging.length, 0);
  assert.equal(early.next?.start, '07:00');
});

test('PUB flood alerts: active, cancelled and expired', () => {
  const alert = (id: string, at: string, area: string) => ({
    datetime: at,
    item: {
      msgType: 'Alert',
      identifier: id,
      readings: [{ headline: 'Flash flood', severity: 'Moderate', area: { areaDesc: area, circle: ['1.3', '103.8', '0.5'] } }],
    },
  });
  const records = [
    alert('A', '2026-10-07T08:00:00+08:00', 'Jalan Boon Lay'),
    alert('B', '2026-10-07T08:05:00+08:00', 'Upper Bukit Timah'),
    { datetime: '2026-10-07T08:10:00+08:00', item: { msgType: 'Cancel', references: 'PUB,B,2026-10-07T08:05:00+08:00', readings: [{}] } },
    alert('C', '2026-10-07T06:00:00+08:00', 'Old'),
    { datetime: '2026-10-07T08:12:00+08:00', item: { readings: [] } },
  ];
  const active = activeFloodAlerts(records, Date.parse('2026-10-07T08:15:00+08:00'));
  assert.deepEqual(active.map((a) => a.area), ['Jalan Boon Lay']);
  assert.equal(active[0].radiusKm, 0.5);
  assert.equal(activeFloodAlerts(records, Date.parse('2026-10-07T09:30:00+08:00')).length, 0);
});

test('Commute trend: building, easing, steady and too little history', () => {
  const t = (min: number) => Date.parse('2026-10-07T00:00:00Z') + min * 60_000;
  assert.equal(trendOf([[t(0), 20]], t(1)), null);
  assert.equal(trendOf([[t(0), 20], [t(5), 21]], t(5)), null);
  assert.equal(trendOf([[t(0), 20], [t(30), 26]], t(30))?.direction, 'building');
  assert.equal(trendOf([[t(0), 26], [t(30), 20]], t(30))?.change, -6);
  assert.equal(trendOf([[t(0), 20], [t(30), 21]], t(30))?.direction, 'steady');
});

test('Distances and the nearest expressway', () => {
  assert.ok(Math.abs(kmBetween(1.3, 103.8, 1.31, 103.8) - 1.11) < 0.01);
  const near = nearestExpressway(1.3, 103.8, [
    ['PIE', 8, 103.79, 1.301, 103.81, 1.301],
    ['CTE', 8, 103.85, 1.35, 103.86, 1.36],
  ]);
  assert.equal(near?.code, 'PIE');
  assert.ok(near!.km < 0.2);
  assert.deepEqual([jamLevel(70), jamLevel(45), jamLevel(25), jamLevel(10)], ['Smooth', 'Busy', 'Jam', 'Massive jam']);
});
