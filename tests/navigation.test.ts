import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchDestination, searchRoadsAndCameras } from '../src/utils/roadSearch.ts';
import { describe, vehicleRateNote } from '../src/utils/erp.ts';
import { ERP_EXPRESSWAY_GANTRIES } from '../src/data/erpRates.ts';

test('search accepts full road names, punctuation and mixed case', () => {
  const road = searchRoadsAndCameras('kallang paya-lebar')[0];
  assert.equal(road.kind, 'road');
  assert.equal(road.id, 'KPE');
  assert.equal(searchRoadsAndCameras('cTe')[0].id, 'CTE');
  assert.equal(searchRoadsAndCameras('nonexistent road').length, 0);
});

test('camera search covers the eight remaining cameras and opens the matching place', () => {
  assert.equal(searchRoadsAndCameras('').filter((r) => r.kind === 'camera').length, 8);
  assert.equal(searchRoadsAndCameras('Woodlands').filter((r) => r.kind === 'camera').length, 3);
  assert.equal(searchRoadsAndCameras('Tuas').filter((r) => r.kind === 'camera').length, 3);
  assert.equal(searchRoadsAndCameras('Harbourfront').filter((r) => r.kind === 'camera').length, 2);
  const causeway = searchRoadsAndCameras('2701')[0];
  assert.deepEqual(searchDestination(causeway), {
    page: 'cameras', tab: 'woodlands', road: null, cam: '2701', cams: null, incident: null,
  });
  const sentosa = searchRoadsAndCameras('4798')[0];
  assert.equal(searchDestination(sentosa).tab, 'all');
});

test('road search clears a previous camera selection and opens expressway traffic', () => {
  assert.deepEqual(searchDestination(searchRoadsAndCameras('PIE')[0]), {
    page: 'radar', tab: 'expressways', road: 'PIE', cam: null, cams: null, incident: null,
  });
});

test('ERP vehicle selection also adjusts upcoming rates in status notes', () => {
  const gantry = ERP_EXPRESSWAY_GANTRIES.find((g) => g.code === 'CTE' && g.gantryNos === '31, 33, 34')!;
  const early = describe(gantry, true, '06:00');
  assert.equal(early.note, 'from 07:30 at S$1.00');
  assert.equal(vehicleRateNote(early.note, 1.5), 'from 07:30 at S$1.50');
  assert.equal(vehicleRateNote('until 09:00, then S$4.00', 0.5), 'until 09:00, then S$2.00');
  assert.equal(vehicleRateNote('Weekends free', 2), 'Weekends free');
});
