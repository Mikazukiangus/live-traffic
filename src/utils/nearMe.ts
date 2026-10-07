import { useEffect, useSyncExternalStore } from 'react';
import type { SpeedSegment } from '../components/SpeedBandMap';

/**
 * The visitor's location for "Near me", shared by every view. It is only requested when they tap
 * Near me; after that, later visits locate again on their own while the browser still allows it.
 * The position stays in memory: it is never stored, sent to /api or put in the address.
 */

export type NearMeStatus = 'idle' | 'locating' | 'found' | 'denied' | 'unavailable';

export interface NearMeState {
  status: NearMeStatus;
  lat?: number;
  lon?: number;
  // When the position was found (ms); changes on every fix.
  at?: number;
}

const OPT_IN_KEY = 'trafficpulse.nearMe';

let state: NearMeState = { status: 'idle' };
const listeners = new Set<() => void>();
const set = (next: NearMeState) => {
  state = next;
  listeners.forEach((l) => l());
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function locate() {
  if (!('geolocation' in navigator)) {
    set({ status: 'unavailable' });
    return;
  }
  set({ ...state, status: 'locating' });
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      set({ status: 'found', lat: pos.coords.latitude, lon: pos.coords.longitude, at: Date.now() });
      try {
        localStorage.setItem(OPT_IN_KEY, '1');
      } catch {
        // Storage blocked; Near me just won't start on its own next time
      }
    },
    (err) => {
      set({ status: err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable' });
      if (err.code === err.PERMISSION_DENIED) {
        try {
          localStorage.removeItem(OPT_IN_KEY);
        } catch {
          // Storage blocked
        }
      }
    },
    { enableHighAccuracy: false, timeout: 15_000, maximumAge: 2 * 60_000 }
  );
}

let resumed = false;
// Locate without a prompt if the visitor used Near me before and the browser still allows it.
async function resumeIfAllowed() {
  if (resumed) return;
  resumed = true;
  try {
    if (localStorage.getItem(OPT_IN_KEY) !== '1') return;
    const permission = await navigator.permissions?.query({ name: 'geolocation' as PermissionName });
    if (permission?.state === 'granted') locate();
  } catch {
    // No Permissions API (older Safari) or storage blocked; wait for a tap
  }
}

export function useNearMe(): NearMeState {
  useEffect(() => {
    resumeIfAllowed();
  }, []);
  return useSyncExternalStore(subscribe, () => state);
}

const COS_LAT = Math.cos((1.35 * Math.PI) / 180);
const KM_PER_DEG = 111.32;

/** Straight-line km between two points (equirectangular; plenty for Singapore). */
export function kmBetween(lat1: number, lon1: number, lat2: number, lon2: number) {
  return Math.hypot((lon1 - lon2) * COS_LAT, lat1 - lat2) * KM_PER_DEG;
}

/** The expressway with a speed band link nearest the point, and how far away it is. */
export function nearestExpressway(lat: number, lon: number, segments: SpeedSegment[]): { code: string; km: number } | null {
  let best: { code: string; km: number } | null = null;
  for (const [code, , sLon, sLat, eLon, eLat] of segments) {
    // Distance to the link as a line, in a local flat frame (degrees of latitude).
    const ax = (sLon - lon) * COS_LAT, ay = sLat - lat;
    const bx = (eLon - lon) * COS_LAT, by = eLat - lat;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const km = Math.hypot(ax + t * dx, ay + t * dy) * KM_PER_DEG;
    if (!best || km < best.km) best = { code, km };
  }
  return best;
}

/** "350 m" or "2.4 km" */
export const formatKm = (km: number) => (km < 1 ? `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m` : `${km.toFixed(1)} km`);
