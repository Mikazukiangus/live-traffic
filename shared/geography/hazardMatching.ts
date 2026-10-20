import { EXPRESSWAY_AREAS } from './expresswayAreas.ts';
import { isCoordinates, kmBetween, type Coordinates, type ReferenceArea } from './coordinates.ts';

export const LIGHTNING_NEAR_KM = 5;
const FLOOD_NEAR_MARGIN_KM = 1.5;
export type HazardMatch<T> =
  | { status: 'ready'; byCode: Record<string, T> }
  | { status: 'unavailable'; reason: 'feed' | 'geography'; byCode: Record<string, T> };

/** Incomplete/duplicate reference sets cannot support a claim of no matches on all roads. */
export function hasExpresswayGeography(areas: readonly ReferenceArea[] | undefined): boolean {
  if (!Array.isArray(areas) || !areas.length || !areas.every((a) => typeof a?.name === 'string' && isCoordinates(a)))
    return false;
  const names = new Set(areas.map((a) => a.name));
  return (
    names.size === areas.length &&
    Object.values(EXPRESSWAY_AREAS).every((list) => list.every((name) => names.has(name)))
  );
}
function pointsByCode(areas: readonly ReferenceArea[]) {
  const byName = new Map(areas.map((a) => [a.name, a]));
  return Object.entries(EXPRESSWAY_AREAS).map(
    ([code, names]) => [code, names.map((name) => byName.get(name)!)] as const,
  );
}

/** Matching depends on reference coordinates, never forecast wording or forecast validity. */
export function matchLightningToExpressways(
  strikes: readonly Coordinates[] | null | undefined,
  areas: readonly ReferenceArea[] | undefined,
): HazardMatch<number> {
  if (!Array.isArray(strikes) || !strikes.every(isCoordinates))
    return { status: 'unavailable', reason: 'feed', byCode: {} };
  if (strikes.length === 0) return { status: 'ready', byCode: {} };
  if (!hasExpresswayGeography(areas)) return { status: 'unavailable', reason: 'geography', byCode: {} };
  const byCode: Record<string, number> = {};
  for (const [code, points] of pointsByCode(areas!)) {
    const count = strikes.filter((s) =>
      points.some((a) => kmBetween(s.lat, s.lon, a.lat, a.lon) <= LIGHTNING_NEAR_KM),
    ).length;
    if (count) byCode[code] = count;
  }
  return { status: 'ready', byCode };
}

export function matchFloodsToExpressways<T extends Coordinates & { radiusKm: number }>(
  alerts: readonly T[] | null | undefined,
  areas: readonly ReferenceArea[] | undefined,
): HazardMatch<T[]> {
  if (
    !Array.isArray(alerts) ||
    !alerts.every((a) => isCoordinates(a) && Number.isFinite(a.radiusKm) && a.radiusKm >= 0)
  )
    return { status: 'unavailable', reason: 'feed', byCode: {} };
  if (alerts.length === 0) return { status: 'ready', byCode: {} };
  if (!hasExpresswayGeography(areas)) return { status: 'unavailable', reason: 'geography', byCode: {} };
  const byCode: Record<string, T[]> = {};
  for (const [code, points] of pointsByCode(areas!)) {
    const near = alerts.filter((f) =>
      points.some((a) => kmBetween(f.lat, f.lon, a.lat, a.lon) <= f.radiusKm + FLOOD_NEAR_MARGIN_KM),
    );
    if (near.length) byCode[code] = near;
  }
  return { status: 'ready', byCode };
}
