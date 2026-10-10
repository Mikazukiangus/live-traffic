import { usePolledJson } from './usePolledJson';
import { kmBetween } from './nearMe';
import { EXPRESSWAY_RAIN_AREAS, ForecastArea } from './rainForecast';

export interface Strike {
  lat: number;
  lon: number;
  time: string | null;
}

export interface HeatStation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  wbgt: number;
  heatStress: string;
}

export interface WeatherAlerts {
  lightningAt: string | null;
  strikes: Strike[] | null;
  heatAt: string | null;
  heatStations: HeatStation[] | null;
}

/** NEA lightning (latest observation) and WBGT heat stress. */
export function useWeatherAlerts() {
  return usePolledJson<WeatherAlerts>('/api/live?feed=weatheralerts', 3 * 60_000, (d) => !!d?.strikes && !!d.heatStations, (d) => Array.isArray(d?.strikes) || Array.isArray(d?.heatStations));
}

// A strike this close to a forecast area an expressway passes through counts as near that expressway.
export const LIGHTNING_NEAR_KM = 5;

/** Strikes near each expressway, using the forecast areas along it as its footprint. */
export function lightningByExpressway(strikes: Strike[] | null | undefined, areas: ForecastArea[] | undefined) {
  const counts: Record<string, number> = {};
  if (!strikes?.length || !areas?.length) return counts;
  const byName = new Map(areas.map((a) => [a.name, a]));
  for (const [code, names] of Object.entries(EXPRESSWAY_RAIN_AREAS)) {
    const pts = names.map((n) => byName.get(n)).filter((a): a is ForecastArea => !!a);
    const n = strikes.filter((s) => pts.some((a) => kmBetween(s.lat, s.lon, a.lat, a.lon) <= LIGHTNING_NEAR_KM)).length;
    if (n) counts[code] = n;
  }
  return counts;
}

export const HEAT_STYLE: Record<string, { dot: string; text: string }> = {
  Low: { dot: 'bg-emerald-500', text: 'text-emerald-700' },
  Moderate: { dot: 'bg-amber-500', text: 'text-amber-700' },
  High: { dot: 'bg-red-600', text: 'text-red-700' },
};
