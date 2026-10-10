import { usePolledJson } from './usePolledJson';
import { kmBetween } from './nearMe';

export interface CarPark {
  id: string;
  name: string;
  agency: 'LTA' | 'HDB' | 'URA' | string;
  lat: number;
  lon: number;
  car?: number;
  motorcycle?: number;
  heavy?: number;
}

/** Every LTA/HDB/URA car park with available lots; nearest ones are picked in the browser. */
export function useCarParks() {
  return usePolledJson<{ fetchedAt: string; carParks: CarPark[] }>('/api/live?feed=carparks', 2 * 60_000, (d) => Array.isArray(d?.carParks));
}

export function nearestCarParks(lat: number, lon: number, parks: CarPark[], limit = 8, lotType?: 'car' | 'motorcycle' | 'heavy') {
  return parks
    .filter((p) => !lotType || p[lotType] != null)
    .map((p) => ({ park: p, km: kmBetween(lat, lon, p.lat, p.lon) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, limit);
}
