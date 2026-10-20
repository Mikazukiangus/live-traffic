export interface Coordinates {
  lat: number;
  lon: number;
}
export interface ReferenceArea extends Coordinates {
  name: string;
}
export const COS_LAT = Math.cos((1.35 * Math.PI) / 180);
export const KM_PER_DEG = 111.32;
export function isCoordinates(value: Coordinates): boolean {
  return (
    !!value &&
    Number.isFinite(value.lat) &&
    value.lat >= -90 &&
    value.lat <= 90 &&
    Number.isFinite(value.lon) &&
    value.lon >= -180 &&
    value.lon <= 180
  );
}
/** Straight-line equirectangular distance; sufficient for Singapore proximity matching. */
export function kmBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return Math.hypot((lon1 - lon2) * COS_LAT, lat1 - lat2) * KM_PER_DEG;
}
