import { config } from '../../config/client';
import { useMemo } from 'react';
import { parseSgt, useNow } from './freshness';
import { usePolledJson } from './usePolledJson';
import { matchFloodsToExpressways } from '../../shared/geography/hazardMatching';
import type { ReferenceArea } from '../../shared/geography/coordinates';

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
    const start = parseSgt(a.startsAt),
      end = parseSgt(a.endsAt);
    return start != null && end != null && start <= now && now < end;
  });
}

/** PUB flood alerts, checked every 2 minutes. */
export function useFloodAlerts() {
  const feed = usePolledJson<FloodAlerts>('/api/live?feed=floods', config.poll.nearbyFeeds, (d) =>
    Array.isArray(d?.alerts),
  );
  const now = useNow();
  const data = useMemo(
    () => (feed.data ? { ...feed.data, alerts: unexpiredFloodAlerts(feed.data.alerts, now) } : null),
    [feed.data, now],
  );
  return { ...feed, data };
}

/** Compatibility projection. Application code uses the explicit matching result. */
export function floodsByExpressway(
  alerts: FloodAlert[] | null | undefined,
  areas: readonly ReferenceArea[] | undefined,
) {
  return matchFloodsToExpressways(alerts, areas).byCode;
}

/** "Flash flood at Jln Boon Lay" style one-liner. */
export const floodLabel = (f: FloodAlert) => (f.area ? `${f.headline} · ${f.area}` : f.headline);
