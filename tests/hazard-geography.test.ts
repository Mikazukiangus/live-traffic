import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FORECAST_AREAS, AREA_CATALOG_SOURCE } from '../shared/geography/forecastAreas.ts';
import { EXPRESSWAY_AREAS } from '../shared/geography/expresswayAreas.ts';
import { kmBetween, KM_PER_DEG } from '../shared/geography/coordinates.ts';
import {
  hasExpresswayGeography,
  matchLightningToExpressways,
  matchFloodsToExpressways,
} from '../shared/geography/hazardMatching.ts';
import { rainIsValid } from '../shared/weather/rain.ts';
import { WeatherPanel } from '../src/features/radar/WeatherPanel.tsx';
import { radarMarkers } from '../src/features/radar/radarSelectors.ts';

const point = FORECAST_AREAS.find((a) => a.name === 'Woodlands')!;
const strike = { lat: point.lat, lon: point.lon, time: null };
const flood = {
  ...strike,
  id: 'fixture-flood',
  radiusKm: 0.5,
  area: 'Woodlands',
  headline: 'Fixture flood',
  description: 'Synthetic alert',
  severity: 'Moderate',
  startsAt: '2026-10-20T01:00:00Z',
  endsAt: '2026-10-20T02:00:00Z',
};

test('versioned reference catalogue covers every expressway without storing weather predictions', () => {
  assert.equal(FORECAST_AREAS.length, 47);
  assert.equal(hasExpresswayGeography(FORECAST_AREAS), true);
  assert.equal(AREA_CATALOG_SOURCE.verifiedOn, '2026-10-20');
  assert.equal(new Set(FORECAST_AREAS.map((a) => a.name)).size, 47);
  assert.ok(FORECAST_AREAS.every((a) => Object.keys(a).sort().join(',') === 'lat,lon,name'));
  assert.ok(Object.isFrozen(FORECAST_AREAS));
  assert.ok(FORECAST_AREAS.every(Object.isFrozen));
});

test('rain expiry or no rain answer cannot remove valid lightning/flood corridor matches', () => {
  const now = Date.parse('2026-10-20T02:00:00Z');
  const expired = {
    issuedAt: '2026-10-20T00:00:00Z',
    validPeriod: {
      start: '2026-10-20T00:00:00Z',
      end: '2026-10-20T01:00:00Z',
      text: 'Expired fixture',
    },
    areas: [{ ...point, forecast: 'Fair' }],
  };
  assert.equal(rainIsValid(expired, now), false);
  for (const forecast of [expired, null]) {
    const currentRain = forecast && rainIsValid(forecast, now) ? forecast : null;
    assert.equal(currentRain, null);
    const lightning = matchLightningToExpressways([strike], FORECAST_AREAS);
    const floods = matchFloodsToExpressways([flood], FORECAST_AREAS);
    assert.equal(lightning.status, 'ready');
    assert.ok(lightning.byCode.BKE > 0 && lightning.byCode.SLE > 0);
    assert.equal(floods.status, 'ready');
    assert.equal(floods.byCode.BKE[0].id, flood.id);
  }
});

test('missing, incomplete, duplicate or invalid reference coordinates produce unavailable matching', () => {
  for (const areas of [
    undefined,
    [],
    [point],
    FORECAST_AREAS.slice(1),
    [...FORECAST_AREAS, point],
    FORECAST_AREAS.map((a) => (a.name === 'Woodlands' ? { ...a, lat: NaN } : a)),
  ]) {
    assert.equal(hasExpresswayGeography(areas), false);
    assert.deepEqual(matchLightningToExpressways([strike], areas), {
      status: 'unavailable',
      reason: 'geography',
      byCode: {},
    });
    assert.deepEqual(matchFloodsToExpressways([flood], areas), {
      status: 'unavailable',
      reason: 'geography',
      byCode: {},
    });
  }
});

test('empty observations are distinct from missing feeds and malformed positions', () => {
  assert.deepEqual(matchLightningToExpressways([], undefined), { status: 'ready', byCode: {} });
  assert.deepEqual(matchFloodsToExpressways([], undefined), { status: 'ready', byCode: {} });
  for (const input of [undefined, null, [{ lat: NaN, lon: 103 }], [{ lat: 95, lon: 103 }]])
    assert.deepEqual(matchLightningToExpressways(input, FORECAST_AREAS), {
      status: 'unavailable',
      reason: 'feed',
      byCode: {},
    });
  for (const input of [undefined, null, [{ ...flood, radiusKm: -1 }], [{ ...flood, radiusKm: Infinity }]])
    assert.equal(matchFloodsToExpressways(input, FORECAST_AREAS).status, 'unavailable');
});

test('distance thresholds and road membership retain the existing town-centre approximation', () => {
  // Move only BKE's reference points together, away from other road footprints.
  const names = new Set(EXPRESSWAY_AREAS.BKE);
  const areas = FORECAST_AREAS.map((a) => (names.has(a.name) ? { ...a, lat: 1, lon: 103 } : a));
  const within = { lat: 1 + 4.99 / KM_PER_DEG, lon: 103 };
  const outside = { lat: 1 + 5.01 / KM_PER_DEG, lon: 103 };
  assert.ok(Math.abs(kmBetween(1, 103, within.lat, within.lon) - 4.99) < 0.000001);
  assert.equal(matchLightningToExpressways([within, within], areas).byCode.BKE, 2);
  assert.equal(matchLightningToExpressways([outside], areas).byCode.BKE, undefined);
  assert.equal(
    matchFloodsToExpressways([{ lat: 1 + 1.99 / KM_PER_DEG, lon: 103, radiusKm: 0.5 }], areas).byCode.BKE.length,
    1,
  );
  assert.equal(
    matchFloodsToExpressways([{ lat: 1 + 2.01 / KM_PER_DEG, lon: 103, radiusKm: 0.5 }], areas).byCode.BKE,
    undefined,
  );
});

function readings(available: boolean, empty = false) {
  const strikes = empty ? [] : [strike];
  const lightningMatch = matchLightningToExpressways(strikes, available ? FORECAST_AREAS : undefined);
  const floodMatch = matchFloodsToExpressways([flood], available ? FORECAST_AREAS : undefined);
  return {
    rainForecast: null,
    rainFeed: { data: null, status: 'error' },
    airQuality: null,
    airFeed: { data: null, status: 'loading', offline: false, fetchedAt: null, refreshing: false },
    weatherAlerts: { data: { strikes, heatStations: [], lightningAt: null, heatAt: null } },
    floodFeed: { data: { checkedAt: null } },
    floodAlerts: [flood],
    lightningMatch,
    floodMatch,
    lightningByCode: lightningMatch.byCode,
    floodsByCode: floodMatch.byCode,
    rainByCode: {},
    strikes,
  } as any;
}
function render(data: ReturnType<typeof readings>) {
  return renderToStaticMarkup(
    createElement(WeatherPanel, { readings: data, navigation: { activeTab: 'weather', corridors: [] } }),
  );
}

test('weather UI cannot label unavailable matching as no nearby lightning and keeps raw flood details', () => {
  const html = render(readings(false));
  assert.match(html, /Expressway matching unavailable/);
  assert.doesNotMatch(html, /No lightning near the expressways/);
  assert.match(html, /Fixture flood/);
  assert.match(html, /Woodlands/);
  const ready = render(readings(true));
  assert.match(ready, /Lightning near/);
  assert.match(ready, /BKE/);
  assert.doesNotMatch(ready, /Expressway matching unavailable/);
  assert.match(render(readings(true, true)), /No lightning near the expressways/);
});

test('hazard marker generation remains independent of geographic corridor matching', () => {
  const sources = readings(false);
  const markers = radarMarkers({ floods: true, lightning: true, incidents: false }, sources, {
    incidents: [],
    status: 'live',
  } as any);
  assert.equal(markers.filter((m) => m.kind === 'flood').length, 1);
  assert.equal(markers.filter((m) => m.kind === 'lightning').length, 1);
});

test('geographic rules and catalogue import no React, hooks, configuration or data transports', async () => {
  for (const file of ['coordinates', 'expresswayAreas', 'forecastAreas', 'hazardMatching']) {
    const source = await readFile(new URL(`../shared/geography/${file}.ts`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from ['"](?:react|.*config\/|.*src\/)/);
    assert.doesNotMatch(source, /\b(?:fetch|localStorage|Notification|useEffect|usePolledJson)\s*[.(]/);
  }
});
