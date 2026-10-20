import { useRadarSources } from './useRadarSources';
import { radarStaleFeeds, radarNearYou, radarMarkers } from './radarSelectors';
import { useState, useMemo } from 'react';
import { EXPRESSWAY_CORRIDORS } from '../../data/expressways';
import { IncidentFeed, countByCorridor } from '../../utils/ltaIncidents';
import { DirectionTravelTime } from '../../utils/ltaTravelTimes';
import { useNow, useOnline } from '../../utils/freshness';
import { useNearMe } from '../../utils/nearMe';

// LTA EstTravelTimes does not cover these, so their time is estimated from length and LTA average speed.
const UNPUBLISHED_TRAVEL_TIME_KM: Record<string, number> = { KPE: 12, MCE: 5 };

const describeTravelTimes = (times: DirectionTravelTime[]) =>
  times.map((t) => `${t.minutes} min to ${t.towards}`).join(' • ');

const LAYERS_STORAGE_KEY = 'trafficpulse.mapLayers';
type MapLayer = 'incidents' | 'floods' | 'lightning';
const readLayers = (): Record<MapLayer, boolean> => {
  const all = { incidents: true, floods: true, lightning: true };
  try {
    return { ...all, ...JSON.parse(localStorage.getItem(LAYERS_STORAGE_KEY) || '{}') };
  } catch {
    return all;
  }
};

export function useRadarReadings(incidentFeed: IncidentFeed, selectedCorridorCode: string) {
  // Live LTA incidents (shared with the notifications drawer)
  const { incidents, status: incidentStatus, fetchedAt: incidentsFetchedAt } = incidentFeed;
  const incidentCounts = useMemo(() => countByCorridor(incidents), [incidents]);
  const expresswayIncidentCount = incidents.filter((inc) => inc.corridorCode).length;
  const criticalCount = incidents.filter((inc) => inc.severity === 'Critical').length;

  const sources = useRadarSources();
  const {
    refreshing,
    speedDetails,
    speedStatus,
    speedBandsUpdated,
    speedSegments,
    speedsFromSnapshot,
    travelTimes,
    rainForecast,
    rainFeed,
    airQuality,
    roadConditions,
    worksByCode,
    weatherAlerts,
    floodFeed,
    floodAlerts,
    lightningMatch,
    floodMatch,
    lightningByCode,
    floodsByCode,
    rainByCode,
  } = sources;
  const selectedCorridor = EXPRESSWAY_CORRIDORS.find((c) => c.code === selectedCorridorCode) || EXPRESSWAY_CORRIDORS[0];
  const selectedSpeed = speedDetails?.[selectedCorridor.code];

  // LTA travel time text, or an estimate (clearly labelled) where LTA publishes none
  const travelTimeText = (code: string): string => {
    const times = travelTimes.byCode[code];
    if (times?.length) return describeTravelTimes(times);
    const km = UNPUBLISHED_TRAVEL_TIME_KM[code];
    const speed = speedDetails?.[code]?.avgSpeedKmH;
    if (km && speed)
      return `≈${Math.max(1, Math.round((km / speed) * 60))} min end to end (estimated; not published by LTA)`;
    if (travelTimes.status === 'loading') return 'Loading…';
    return 'Not available';
  };

  // KPE and MCE: end to end from length and LTA average speed
  const estimateMinutes = (code: string) => {
    const km = UNPUBLISHED_TRAVEL_TIME_KM[code];
    const speed = speedDetails?.[code]?.avgSpeedKmH;
    return km && speed ? Math.max(1, Math.round((km / speed) * 60)) : null;
  };

  const speedUnavailableText = speedStatus === 'loading' ? 'Loading LTA speeds…' : 'LTA speeds unavailable';
  const speedsUpdatedSgt = speedBandsUpdated ? speedBandsUpdated.slice(11, 16) : null;

  // Which feeds are behind, said plainly rather than shown as if current
  const now = useNow();
  const online = useOnline();
  const staleFeeds = radarStaleFeeds(sources, incidentFeed, now);

  // Near me: nearest expressway, rain area and air region (location stays on the device)
  const nearMe = useNearMe();
  const nearYou = useMemo(() => radarNearYou(sources, nearMe, now), [sources, nearMe, now]);

  // Map layers: incidents, flood alerts and lightning, each switchable
  const [layers, setLayers] = useState(readLayers);
  const toggleLayer = (layer: MapLayer) =>
    setLayers((l) => {
      const next = { ...l, [layer]: !l[layer] };
      try {
        localStorage.setItem(LAYERS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Storage blocked; the choice lasts until the page closes
      }
      return next;
    });
  const strikes = weatherAlerts.data?.strikes || [];
  const mappedIncidents = incidents.filter((i) => i.lat != null && i.lon != null);
  const mapMarkers = useMemo(() => radarMarkers(layers, sources, incidentFeed), [layers, sources, incidentFeed]);

  return {
    refreshing,
    incidents,
    incidentStatus,
    incidentsFetchedAt,
    incidentCounts,
    expresswayIncidentCount,
    criticalCount,
    speedDetails,
    speedStatus,
    speedBandsUpdated,
    speedSegments,
    speedsFromSnapshot,
    travelTimes,
    rainForecast,
    rainFeed,
    airQuality,
    roadConditions,
    worksByCode,
    weatherAlerts,
    floodFeed,
    floodAlerts,
    lightningMatch,
    floodMatch,
    lightningByCode,
    floodsByCode,
    rainByCode,
    selectedCorridor,
    selectedSpeed,
    travelTimeText,
    estimateMinutes,
    speedUnavailableText,
    speedsUpdatedSgt,
    now,
    online,
    staleFeeds,
    nearMe,
    nearYou,
    layers,
    toggleLayer,
    strikes,
    mappedIncidents,
    mapMarkers,
  };
}
export type RadarReadings = ReturnType<typeof useRadarReadings>;
