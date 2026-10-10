import { useMemo } from 'react';
import { usePolledJson } from './usePolledJson';
import { parseSgt, useNow } from './freshness';
import { CongestionStatus } from '../types/traffic';
import type { SpeedSegment } from '../components/SpeedBandMap';

export interface ExpresswaySpeed {
  code: string;
  avgSpeedKmH: number;
  status: CongestionStatus;
}

// LTA speed bands refresh every 5 minutes; /api/expresswayspeeds is CDN-cached for that window.
const SPEEDS_POLL_MS = 60_000;

/** Live LTA average speed per expressway (summary only, without map segments). */
export function useExpresswaySpeeds() {
  const feed = usePolledJson<{ expressways: ExpresswaySpeed[]; lastUpdatedTime?: string }>('/api/expresswayspeeds', SPEEDS_POLL_MS, (d) => Array.isArray(d?.expressways) && d.expressways.length > 0);
  const byCode = useMemo(() => Object.fromEntries((feed.data?.expressways || []).map((e) => [e.code, e])), [feed.data]);
  const now = useNow();
  const updatedAt = parseSgt(feed.data?.lastUpdatedTime);
  const stale = updatedAt != null && now - updatedAt > 15 * 60_000;
  return { byCode, status: feed.status, stale };
}

/** Last received speeds stay useful, with an explicit failure/age label. */
export function describeExpresswaySpeed(speeds: { byCode: Record<string, ExpresswaySpeed>; status: 'loading' | 'live' | 'error'; stale?: boolean }, code: string): string {
  const s = speeds.byCode[code];
  if (s) return `${s.avgSpeedKmH} km/h • ${s.status}${speeds.status === 'error' ? ' (last received; refresh failed)' : speeds.stale ? ' (outdated)' : ''}`;
  return speeds.status === 'loading' ? 'Loading LTA speed…' : 'LTA speed unavailable';
}

// ---- Traffic around a point (e.g. a camera), from LTA speed band links ----


export type JamLevel = 'Smooth' | 'Busy' | 'Jam' | 'Massive jam';

export const JAM_STYLE: Record<JamLevel, { dot: string; text: string }> = {
  Smooth: { dot: 'bg-emerald-500', text: 'text-emerald-700' },
  Busy: { dot: 'bg-amber-400', text: 'text-amber-700' },
  Jam: { dot: 'bg-orange-500', text: 'text-orange-700' },
  'Massive jam': { dot: 'bg-red-600', text: 'text-red-700' },
};

export const jamLevel = (kmh: number): JamLevel =>
  kmh >= 60 ? 'Smooth' : kmh >= 40 ? 'Busy' : kmh >= 20 ? 'Jam' : 'Massive jam';

// Typical km/h per LTA speed band (band 8 is 70 and above).
const BAND_KMH: Record<number, number> = { 1: 5, 2: 15, 3: 25, 4: 35, 5: 45, 6: 55, 7: 65, 8: 80 };
const NEAR_METRES = 400;
const COS_LAT = Math.cos((1.35 * Math.PI) / 180);

// The AYE ends inside Tuas Checkpoint, where links through the immigration booths always read
// 0-20 km/h because every vehicle stops. Leave them out so empty roads aren't shown as jammed.
// Keep in sync with api/expresswayspeeds.ts.
export const CHECKPOINT_BOOTH_ZONES = [{ name: 'Tuas Checkpoint', minLat: 1.3463, maxLat: 1.35, minLon: 103.634, maxLon: 103.6385 }];

export const inBoothZone = (lat: number, lon: number) =>
  CHECKPOINT_BOOTH_ZONES.some((z) => lat >= z.minLat && lat <= z.maxLat && lon >= z.minLon && lon <= z.maxLon);

export interface NearbyTraffic {
  speedKmH: number;
  level: JamLevel;
}

/**
 * Speed of the slower direction of expressway traffic within 400 m of a point.
 * Links are split into two directions by heading; each direction's speed is the
 * length-weighted harmonic mean (i.e. its travel-time average). Null if no links are near.
 */
export function trafficNear(lat: number, lon: number, segments: SpeedSegment[]): NearbyTraffic | null {
  const near = segments.filter(([, , sLon, sLat, eLon, eLat]) => {
    if (inBoothZone((sLat + eLat) / 2, (sLon + eLon) / 2)) return false;
    const dy = ((sLat + eLat) / 2 - lat) * 111_320;
    const dx = ((sLon + eLon) / 2 - lon) * 111_320 * COS_LAT;
    return Math.hypot(dx, dy) <= NEAR_METRES;
  });
  if (near.length === 0) return null;

  const vector = ([, , sLon, sLat, eLon, eLat]: SpeedSegment) => [(eLon - sLon) * COS_LAT, eLat - sLat];
  const [rx, ry] = vector(near[0]);
  const groups: [number, number][] = [[0, 0], [0, 0]]; // [km, hours] per direction
  for (const seg of near) {
    const [vx, vy] = vector(seg);
    const km = Math.hypot(vx, vy) * 111.32;
    const g = groups[vx * rx + vy * ry >= 0 ? 0 : 1];
    g[0] += km;
    g[1] += km / BAND_KMH[seg[1]];
  }
  const speeds = groups.filter(([km, h]) => km > 0 && h > 0).map(([km, h]) => km / h);
  const speedKmH = Math.round(Math.min(...speeds));
  return { speedKmH, level: jamLevel(speedKmH) };
}
