import { useEffect, useState } from 'react';
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
  const [byCode, setByCode] = useState<Record<string, ExpresswaySpeed>>({});
  const [status, setStatus] = useState<'loading' | 'live' | 'error'>('loading');

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/expresswayspeeds');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!Array.isArray(json?.expressways) || json.expressways.length === 0) throw new Error('No speeds');
        setByCode(Object.fromEntries(json.expressways.map((e: ExpresswaySpeed) => [e.code, e])));
        setStatus('live');
      } catch {
        // Keep the last live speeds, if any
        setStatus('error');
      }
    };
    load();
    const interval = setInterval(load, SPEEDS_POLL_MS);
    return () => clearInterval(interval);
  }, []);

  return { byCode, status };
}

/** "64 km/h • Smooth", or a loading/unavailable message. */
export function describeExpresswaySpeed(speeds: ReturnType<typeof useExpresswaySpeeds>, code: string): string {
  const s = speeds.byCode[code];
  if (s) return `${s.avgSpeedKmH} km/h • ${s.status}`;
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
