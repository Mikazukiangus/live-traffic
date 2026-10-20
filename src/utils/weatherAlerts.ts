import { config } from '../../config/client';
import { usePolledJson } from './usePolledJson';
import { matchLightningToExpressways } from '../../shared/geography/hazardMatching';
import type { ReferenceArea } from '../../shared/geography/coordinates';
export { LIGHTNING_NEAR_KM } from '../../shared/geography/hazardMatching';

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
  return usePolledJson<WeatherAlerts>(
    '/api/live?feed=weatheralerts',
    config.poll.weatherAlerts,
    (d) => !!d?.strikes && !!d.heatStations,
    (d) => Array.isArray(d?.strikes) || Array.isArray(d?.heatStations),
  );
}

/** Compatibility projection. Application code uses the explicit matching result. */
export function lightningByExpressway(
  strikes: Strike[] | null | undefined,
  areas: readonly ReferenceArea[] | undefined,
) {
  return matchLightningToExpressways(strikes, areas).byCode;
}

export const HEAT_STYLE: Record<string, { dot: string; text: string }> = {
  Low: { dot: 'bg-emerald-500', text: 'text-emerald-700' },
  Moderate: { dot: 'bg-amber-500', text: 'text-amber-700' },
  High: { dot: 'bg-red-600', text: 'text-red-700' },
};
