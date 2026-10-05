import { useEffect, useState } from 'react';
import type { SpeedSegment } from '../components/SpeedBandMap';

export interface ForecastArea {
  name: string;
  lat: number;
  lon: number;
  forecast: string;
}

export interface RainForecast {
  issuedAt: string;
  validPeriod: { start: string; end: string; text: string };
  areas: ForecastArea[];
}

// Ordered from dry to most severe, so levels can be compared.
export type RainLevel = 'dry' | 'rain' | 'heavy' | 'thundery';
const LEVEL_RANK: Record<RainLevel, number> = { dry: 0, rain: 1, heavy: 2, thundery: 3 };

export const RAIN_LEVEL_STYLE: Record<RainLevel, { icon: string; className: string }> = {
  dry: { icon: 'partly_cloudy_day', className: 'text-slate-500' },
  rain: { icon: 'rainy', className: 'text-sky-700' },
  heavy: { icon: 'rainy_heavy', className: 'text-blue-800 font-semibold' },
  thundery: { icon: 'thunderstorm', className: 'text-violet-800 font-semibold' },
};

// NEA forecast wording, e.g. "Fair (Day)", "Passing Showers", "Heavy Thundery Showers with Gusty Winds".
export function rainLevel(forecast: string): RainLevel {
  const f = forecast.toLowerCase();
  if (f.includes('thunder')) return 'thundery';
  if (f.includes('heavy') && /rain|shower/.test(f)) return 'heavy';
  if (/rain|shower|drizzle/.test(f)) return 'rain';
  return 'dry';
}

const worseLevel = (a: RainLevel, b: RainLevel) => (LEVEL_RANK[b] > LEVEL_RANK[a] ? b : a);

// Squared equirectangular distance; enough to rank the nearest of 47 areas.
function distance2(lat1: number, lon1: number, lat2: number, lon2: number) {
  const dx = (lon1 - lon2) * Math.cos((1.35 * Math.PI) / 180);
  const dy = lat1 - lat2;
  return dx * dx + dy * dy;
}

export function nearestArea(lat: number, lon: number, areas: ForecastArea[]): ForecastArea | null {
  let best: ForecastArea | null = null;
  let bestD = Infinity;
  for (const a of areas) {
    const d = distance2(lat, lon, a.lat, a.lon);
    if (d < bestD) {
      best = a;
      bestD = d;
    }
  }
  return best;
}

export interface CorridorRain {
  level: RainLevel;
  areaCount: number;
  // Areas along the expressway forecast to have rain, worst first.
  wetAreas: ForecastArea[];
}

// Rain outlook per expressway: each speed band link is assigned its nearest forecast area.
export function rainByExpressway(segments: SpeedSegment[], areas: ForecastArea[]): Record<string, CorridorRain> {
  const areasByCode = new Map<string, Set<ForecastArea>>();
  for (const [code, , sLon, sLat, eLon, eLat] of segments) {
    const area = nearestArea((sLat + eLat) / 2, (sLon + eLon) / 2, areas);
    if (!area) continue;
    if (!areasByCode.has(code)) areasByCode.set(code, new Set());
    areasByCode.get(code)!.add(area);
  }

  const result: Record<string, CorridorRain> = {};
  for (const [code, set] of areasByCode) {
    const list = [...set];
    const wetAreas = list
      .filter((a) => rainLevel(a.forecast) !== 'dry')
      .sort((a, b) => LEVEL_RANK[rainLevel(b.forecast)] - LEVEL_RANK[rainLevel(a.forecast)]);
    result[code] = {
      level: wetAreas.reduce<RainLevel>((lvl, a) => worseLevel(lvl, rainLevel(a.forecast)), 'dry'),
      areaCount: list.length,
      wetAreas,
    };
  }
  return result;
}

export function describeCorridorRain(rain: CorridorRain): string {
  const areas = `${rain.areaCount} ${rain.areaCount === 1 ? 'area' : 'areas'}`;
  if (rain.wetAreas.length === 0) return `No rain expected (${areas})`;
  const names = rain.wetAreas.slice(0, 2).map((a) => a.name).join(', ');
  const more = rain.wetAreas.length > 2 ? ` +${rain.wetAreas.length - 2}` : '';
  return `${rain.wetAreas[0].forecast}: ${names}${more} (${rain.wetAreas.length} of ${areas})`;
}

// NEA updates roughly every 30 minutes; the endpoint is CDN-cached for 5.
const RAIN_POLL_MS = 5 * 60_000;

export function useRainForecast(): RainForecast | null {
  const [forecast, setForecast] = useState<RainForecast | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/rainforecast');
        if (!res.ok) return;
        const json = await res.json();
        if (Array.isArray(json?.areas) && json.areas.length > 0) setForecast(json);
      } catch {
        // Keep the last forecast
      }
    };
    load();
    const interval = setInterval(load, RAIN_POLL_MS);
    return () => clearInterval(interval);
  }, []);

  return forecast;
}
