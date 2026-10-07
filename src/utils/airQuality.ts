import { useEffect, useState } from 'react';

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
const AIR_POLL_MS = 10 * 60_000;
const RETRY_MS = 30_000;

export function useAirQuality(): AirQuality | null {
  const [air, setAir] = useState<AirQuality | null>(null);

  useEffect(() => {
    let loaded = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const res = await fetch('/api/airquality');
        const json = res.ok ? await res.json() : null;
        if (Array.isArray(json?.regions) && json.regions.length > 0) {
          setAir(json);
          // Show a partial answer (one feed failed) but keep retrying until both are in.
          loaded = json.regions.every((r: RegionAirQuality) => r.psi24h != null && r.pm25OneHour != null);
        }
      } catch {
        // Keep the last readings
      }
      // Until full readings arrive, try again soon rather than at the next poll.
      if (!loaded) retry = setTimeout(load, RETRY_MS);
    };
    load();
    const interval = setInterval(() => loaded && load(), AIR_POLL_MS);
    return () => {
      clearInterval(interval);
      clearTimeout(retry);
    };
  }, []);

  return air;
}
