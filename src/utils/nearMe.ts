import { COS_LAT, KM_PER_DEG } from '../../shared/geography/coordinates';
export { kmBetween } from '../../shared/geography/coordinates';
import { useEffect, useSyncExternalStore } from 'react';
import type { SpeedSegment } from '../../shared/traffic/types';

/**
 * The visitor's location for "Near me", shared by every view. It is only requested when they tap
 * Near me; after that, later visits locate again on their own while the browser still allows it.
 * The position stays in memory: it is never stored, sent to /api or put in the address.
 */

export type { NearMeStatus, NearMeState } from './nearMeResource';
import type { NearMeState } from './nearMeResource';
import { createNearMeResource } from './nearMeResource';
const OPT_IN_KEY = 'trafficpulse.nearMe';
const resource = createNearMeResource({
  locate: (success, failure) => navigator.geolocation.getCurrentPosition(success, failure,
    { enableHighAccuracy: false, timeout: 15_000, maximumAge: 2 * 60_000 }),
  optedIn: () => localStorage.getItem(OPT_IN_KEY) === '1',
  remember: enabled => enabled ? localStorage.setItem(OPT_IN_KEY, '1') : localStorage.removeItem(OPT_IN_KEY),
  permission: async () => (await navigator.permissions?.query({ name: 'geolocation' }))?.state === 'granted',
  now: Date.now,
});
export const locate = resource.locate;
export function useNearMe(): NearMeState {
  useEffect(() => { void resource.resume(); }, []);
  return useSyncExternalStore(resource.subscribe, resource.getSnapshot);
}

/** The expressway with a speed band link nearest the point, and how far away it is. */
export function nearestExpressway(
  lat: number,
  lon: number,
  segments: SpeedSegment[],
): { code: string; km: number } | null {
  let best: { code: string; km: number } | null = null;
  for (const [code, , sLon, sLat, eLon, eLat] of segments) {
    // Distance to the link as a line, in a local flat frame (degrees of latitude).
    const ax = (sLon - lon) * COS_LAT,
      ay = sLat - lat;
    const bx = (eLon - lon) * COS_LAT,
      by = eLat - lat;
    const dx = bx - ax,
      dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const km = Math.hypot(ax + t * dx, ay + t * dy) * KM_PER_DEG;
    if (!best || km < best.km) best = { code, km };
  }
  return best;
}

/** "350 m" or "2.4 km" */
export const formatKm = (km: number) =>
  km < 1 ? `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m` : `${km.toFixed(1)} km`;
