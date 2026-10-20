/** Representative speeds for LTA's eight bands. Keep the different averaging algorithms separate. */
export const BAND_SPEED_KMH: Readonly<Record<number, number>> = Object.freeze({
  1: 5,
  2: 15,
  3: 25,
  4: 35,
  5: 45,
  6: 55,
  7: 65,
  8: 80,
});
export const CHECKPOINT_BOOTH_ZONES = Object.freeze([
  Object.freeze({ name: 'Tuas Checkpoint', minLat: 1.3463, maxLat: 1.35, minLon: 103.634, maxLon: 103.6385 }),
]);
export const inBoothZone = (lat: number, lon: number) =>
  CHECKPOINT_BOOTH_ZONES.some((z) => lat >= z.minLat && lat <= z.maxLat && lon >= z.minLon && lon <= z.maxLon);
