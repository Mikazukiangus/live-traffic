import { EXPRESSWAY_AREAS as EXPRESSWAY_RAIN_AREAS } from '../../shared/geography/expresswayAreas';
export { EXPRESSWAY_AREAS as EXPRESSWAY_RAIN_AREAS } from '../../shared/geography/expresswayAreas';
import type { ForecastArea } from '../../shared/weather/rain';
import { useRainFeed } from '../features/weather/useRainFeed';
export type { ForecastArea, RainForecast } from '../../shared/weather/rain';

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

// Rain outlook per expressway from the latest NEA 2-hour forecast.
export function rainByExpressway(areas: ForecastArea[]): Record<string, CorridorRain> {
  const byName = new Map(areas.map((a) => [a.name, a]));
  const areasByCode = new Map<string, ForecastArea[]>();
  for (const [code, names] of Object.entries(EXPRESSWAY_RAIN_AREAS)) {
    const found = names.map((n) => byName.get(n)).filter((a): a is ForecastArea => !!a);
    if (found.length) areasByCode.set(code, found);
  }

  const result: Record<string, CorridorRain> = {};
  for (const [code, list] of areasByCode) {
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
  const names = rain.wetAreas
    .slice(0, 2)
    .map((a) => a.name)
    .join(', ');
  const more = rain.wetAreas.length > 2 ? ` +${rain.wetAreas.length - 2}` : '';
  return `${rain.wetAreas[0].forecast}: ${names}${more} (${rain.wetAreas.length} of ${areas})`;
}

// Compatibility hook; polling/state is shared across all consumers.
export function useRainForecast() {
  return useRainFeed().data;
}
