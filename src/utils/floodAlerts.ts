import { useMemo } from 'react';
import { parseSgt, useNow } from './freshness';
import { usePolledJson } from './usePolledJson';
import { kmBetween } from './nearMe';
import { EXPRESSWAY_RAIN_AREAS, ForecastArea } from './rainForecast';

/** An active PUB flood alert (see api/_floods.ts). */
export interface FloodAlert {
  id: string;
  headline: string;
  description: string;
  area: string;
  severity: string;
  lat: number;
  lon: number;
  radiusKm: number;
  startsAt: string;
  endsAt: string;
}

export interface FloodAlerts {
  checkedAt: string | null;
  alerts: FloodAlert[];
}

/** Expiry is checked on the device too, including when offline or a refresh fails. */
export function unexpiredFloodAlerts(alerts: FloodAlert[], now: number): FloodAlert[] {
  return alerts.filter((a) => {
    const start = parseSgt(a.startsAt), end = parseSgt(a.endsAt);
    return start != null && end != null && start <= now && now < end;
  });
}

/** PUB flood alerts, checked every 2 minutes. */
export function useFloodAlerts() {
  const feed = usePolledJson<FloodAlerts>('/api/live?feed=floods', 2 * 60_000, (d) => Array.isArray(d?.alerts));
  const now = useNow();
  const data = useMemo(() => feed.data ? { ...feed.data, alerts: unexpiredFloodAlerts(feed.data.alerts, now) } : null, [feed.data, now]);
  return { ...feed, data };
}

// An alert counts as on an expressway when its circle reaches within this distance of a
// forecast area the expressway passes through (forecast areas are town centres, not the road).
const NEAR_MARGIN_KM = 1.5;

/** Flood alerts near each expressway, using the forecast areas along it as its footprint. */
export function floodsByExpressway(alerts: FloodAlert[] | null | undefined, areas: ForecastArea[] | undefined) {
  const byCode: Record<string, FloodAlert[]> = {};
  if (!alerts?.length || !areas?.length) return byCode;
  const byName = new Map(areas.map((a) => [a.name, a]));
  for (const [code, names] of Object.entries(EXPRESSWAY_RAIN_AREAS)) {
    const pts = names.map((n) => byName.get(n)).filter((a): a is ForecastArea => !!a);
    const near = alerts.filter((f) => pts.some((a) => kmBetween(f.lat, f.lon, a.lat, a.lon) <= f.radiusKm + NEAR_MARGIN_KM));
    if (near.length) byCode[code] = near;
  }
  return byCode;
}

/** "Flash flood at Jln Boon Lay" style one-liner. */
export const floodLabel = (f: FloodAlert) => (f.area ? `${f.headline} · ${f.area}` : f.headline);
