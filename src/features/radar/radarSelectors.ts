import { airNotices } from '../weather/airFreshness';
import { rainNotice } from '../weather/rainFreshness';
import { RadarSources } from './useRadarSources';
import { IncidentFeed } from '../../utils/ltaIncidents';
import { NearMeState } from '../../utils/nearMe';
import { nearestExpressway, kmBetween } from '../../utils/nearMe';
import { EXPRESSWAY_RAIN_AREAS, nearestArea } from '../../utils/rainForecast';
import { nearestRegion } from '../../utils/airQuality';
import { erpOn } from '../../utils/erp';
import { parseSgt, sgtClock, type StaleFeed } from '../../utils/freshness';
import { floodLabel } from '../../utils/floodAlerts';
import { MapMarker } from '../../components/SpeedBandMap';
import { config } from '../../../config/client';
const SPEEDS_STALE_MS = config.freshness.speeds;
const LIGHTNING_STALE_MS = config.freshness.lightning;
export function radarStaleFeeds(sources: RadarSources, incidentFeed: IncidentFeed, now: number) {
  const {
    speedBandsUpdated,
    speedStatus,
    travelTimes,
    rainFeed,
    airFeed,
    roadConditions,
    weatherAlerts,
    floodFeed,
  } = sources;
  const { status: incidentStatus, fetchedAt: incidentsFetchedAt } = incidentFeed;
  const staleFeeds: StaleFeed[] = [];
  if ([sources.lightningMatch, sources.floodMatch].some((m) => m.status === 'unavailable' && m.reason === 'geography'))
    staleFeeds.push({
      label: 'Expressway hazard matching',
      detail: 'reference locations unavailable; use the mapped hazard locations',
    });
  const speedsAt = parseSgt(speedBandsUpdated);
  if (speedStatus === 'error' || (speedsAt && now - speedsAt > SPEEDS_STALE_MS)) {
    staleFeeds.push({
      label: 'LTA speeds',
      detail: speedsAt
        ? `from ${sgtClock(speedsAt)} SGT${speedStatus === 'error' ? ', the feed is not responding' : ''}`
        : 'unavailable, the feed is not responding',
    });
  }
  if (travelTimes.status === 'error')
    staleFeeds.push({ label: 'LTA travel times', detail: 'not responding; times may be old or missing' });
  if (incidentStatus === 'error') {
    staleFeeds.push({
      label: 'LTA incidents',
      detail: incidentsFetchedAt
        ? `last received ${incidentsFetchedAt} SGT, the feed is not responding`
        : 'unavailable, the feed is not responding',
    });
  }
  const rainWarning = rainNotice(rainFeed, now);
  if (rainWarning) staleFeeds.push(rainWarning);
  staleFeeds.push(...airNotices(airFeed, now));
  if (roadConditions.status === 'error')
    staleFeeds.push({ label: 'LTA road works & traffic lights', detail: 'not responding' });
  if (weatherAlerts.status === 'error')
    staleFeeds.push({ label: 'NEA lightning & heat stress', detail: 'not responding' });
  if (floodFeed.status === 'error')
    staleFeeds.push({ label: 'PUB flood alerts', detail: 'not responding; alerts may be missing' });
  const lightningAt = parseSgt(weatherAlerts.data?.lightningAt);
  if (lightningAt && now - lightningAt > LIGHTNING_STALE_MS) {
    staleFeeds.push({ label: 'NEA lightning', detail: `last observation ${sgtClock(lightningAt)} SGT` });
  }

  return staleFeeds;
}
export function radarNearYou(sources: RadarSources, nearMe: NearMeState, now: number) {
  const { rainForecast, airQuality, speedSegments } = sources;
  if (nearMe.status !== 'found' || nearMe.lat == null || nearMe.lon == null) return null;
  const { lat, lon } = nearMe;
  const area = rainForecast ? nearestArea(lat, lon, rainForecast.areas) : null;
  let road: { code: string; km: number; approx?: boolean } | null = speedSegments.length
    ? nearestExpressway(lat, lon, speedSegments)
    : null;
  // Without LTA speeds, use the nearest forecast area that an expressway passes through.
  if (!road && rainForecast) {
    const onRoute = rainForecast.areas.filter((a) =>
      Object.values(EXPRESSWAY_RAIN_AREAS).some((names) => names.includes(a.name)),
    );
    const via = nearestArea(lat, lon, onRoute);
    const code = via && Object.keys(EXPRESSWAY_RAIN_AREAS).find((c) => EXPRESSWAY_RAIN_AREAS[c].includes(via.name));
    if (via && code) road = { code, km: kmBetween(lat, lon, via.lat, via.lon), approx: true };
  }
  const region = airQuality ? nearestRegion(lat, lon, airQuality) : null;
  const erp = road ? erpOn([road.code], new Date(now)) : null;
  return { area, road, region, erp };
}
export function radarMarkers(
  layers: Record<'incidents' | 'floods' | 'lightning', boolean>,
  sources: RadarSources,
  incidentFeed: IncidentFeed,
): MapMarker[] {
  const strikes = sources.weatherAlerts.data?.strikes || [];
  const floodAlerts = sources.floodAlerts;
  const mappedIncidents = incidentFeed.incidents.filter((i) => i.lat != null && i.lon != null);
  const list: MapMarker[] = [];
  if (layers.lightning)
    strikes.forEach((st, i) =>
      list.push({ id: `lightning-${i}`, kind: 'lightning', lat: st.lat, lon: st.lon, label: 'Lightning strike (NEA)' }),
    );
  if (layers.floods)
    floodAlerts.forEach((f) =>
      list.push({
        id: f.id,
        kind: 'flood',
        lat: f.lat,
        lon: f.lon,
        radiusKm: f.radiusKm,
        label: `${floodLabel(f)} (PUB)`,
      }),
    );
  if (layers.incidents)
    mappedIncidents.forEach((i) =>
      list.push({
        id: i.id,
        kind: i.severity === 'Critical' ? 'critical' : 'incident',
        lat: i.lat!,
        lon: i.lon!,
        code: i.corridorCode,
        label: `${i.type}${i.corridorCode ? ` on ${i.corridorCode}` : ''}: ${i.location}`,
      }),
    );
  return list;
}
