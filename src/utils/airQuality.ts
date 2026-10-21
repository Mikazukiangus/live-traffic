import { config } from '../../config/client';
import { isLatitude, isLongitude, isRecord } from '../../shared/traffic/validation';
import { parseSgt } from '../../shared/time';
import { createBrowserFeed, useSharedFeed } from '../features/feeds/useSharedFeed';

export type AirRegion = 'north' | 'south' | 'east' | 'west' | 'central';

export interface RegionAirQuality {
  name: AirRegion;
  lat: number | null;
  lon: number | null;
  psi24h: number | null;
  pm25OneHour: number | null;
  pm25TwentyFourHour: number | null;
}

export interface AirQuality {
  psiTimestamp: string | null;
  pm25Timestamp: string | null;
  regions: RegionAirQuality[];
}

const nullableReading = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0);
const nullableTimestamp = (v: unknown) => v === null || (typeof v === 'string' && parseSgt(v) !== null);
export function isAirQuality(value: unknown): value is AirQuality {
  if (
    !isRecord(value) ||
    !nullableTimestamp(value.psiTimestamp) ||
    !nullableTimestamp(value.pm25Timestamp) ||
    !Array.isArray(value.regions) ||
    !value.regions.length
  )
    return false;
  const names = new Set<unknown>();
  return value.regions.every((r: unknown) => {
    if (
      !isRecord(r) ||
      typeof r.name !== 'string' ||
      !Object.hasOwn(REGION_LABEL, r.name) ||
      names.has(r.name)
    )
      return false;
    names.add(r.name);
    return (
      (r.lat === null || isLatitude(r.lat)) &&
      (r.lon === null || isLongitude(r.lon)) &&
      nullableReading(r.psi24h) &&
      nullableReading(r.pm25OneHour) &&
      nullableReading(r.pm25TwentyFourHour)
    );
  });
}

export interface AirBand {
  label: string;
  dot: string;
  text: string;
}

export const REGION_LABEL: Record<AirRegion, string> = {
  north: 'North',
  south: 'South',
  east: 'East',
  west: 'West',
  central: 'Central',
};

// NEA's 24-hour PSI descriptors.
export function psiBand(psi: number): AirBand {
  if (psi <= 50) return { label: 'Good', dot: 'bg-emerald-500', text: 'text-emerald-700' };
  if (psi <= 100) return { label: 'Moderate', dot: 'bg-yellow-400', text: 'text-yellow-800' };
  if (psi <= 200) return { label: 'Unhealthy', dot: 'bg-orange-500', text: 'text-orange-700' };
  if (psi <= 300) return { label: 'Very unhealthy', dot: 'bg-red-600', text: 'text-red-700' };
  return { label: 'Hazardous', dot: 'bg-violet-800', text: 'text-violet-800' };
}

// NEA's 1-hour PM2.5 concentration bands (µg/m³).
export function pm25Band(pm25: number): AirBand {
  if (pm25 <= 55) return { label: 'Normal', dot: 'bg-emerald-500', text: 'text-emerald-700' };
  if (pm25 <= 150) return { label: 'Elevated', dot: 'bg-yellow-400', text: 'text-yellow-800' };
  if (pm25 <= 250) return { label: 'High', dot: 'bg-orange-500', text: 'text-orange-700' };
  return { label: 'Very high', dot: 'bg-red-600', text: 'text-red-700' };
}

/** The region whose NEA label point is nearest, e.g. Woodlands → North, Tuas → West. */
export function nearestRegion(lat: number, lon: number, air: AirQuality): RegionAirQuality | null {
  let best: RegionAirQuality | null = null;
  let bestD = Infinity;
  for (const r of air.regions) {
    if (r.lat == null || r.lon == null) continue;
    const d = (r.lat - lat) ** 2 + (r.lon - lon) ** 2;
    if (d < bestD) {
      best = r;
      bestD = d;
    }
  }
  return best;
}

/** "10:00" from an NEA timestamp such as 2026-10-07T10:00:00+08:00 (already SGT). */
export const sgtHour = (timestamp: string | null) => timestamp?.slice(11, 16) ?? null;

// NEA updates hourly; the endpoint is CDN-cached for 5 minutes.
const airFeed = createBrowserFeed({ url: '/api/airquality', pollMs: config.poll.air, isValid: isAirQuality });
export function useAirQuality(): AirQuality | null {
  return useSharedFeed(airFeed).data;
}
