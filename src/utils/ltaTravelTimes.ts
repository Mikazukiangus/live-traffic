/**
 * LTA DataMall EstTravelTimes, summed per expressway and direction.
 * Each record is one stretch, e.g. { Name: 'PIE', Direction: 2, FarEndPoint: 'CHANGI AIRPORT', EstTime: 3 },
 * so adding a direction's stretches gives the end-to-end time. LTA does not publish KPE or MCE.
 */
import { useMemo } from 'react';
import { usePolledJson } from './usePolledJson';

interface LtaTravelTimeRecord {
  Name: string;
  Direction: number;
  FarEndPoint: string;
  StartPoint?: string;
  EndPoint?: string;
  EstTime: number;
}

/** One expressway direction as LTA's ordered stretches, e.g. Tuas Checkpoint -> Tuas West Rd, 1 min. */
export interface TravelRoute {
  code: string;
  direction: number;
  towards: string;
  stretches: { from: string; to: string; minutes: number }[];
}

export interface DirectionTravelTime {
  towards: string;
  minutes: number;
}

// Expressway codes stay in capitals, e.g. "PIE/AYE Interchange", "Exit to CTE".
const ROAD_CODES = new Set(['PIE', 'AYE', 'ECP', 'CTE', 'TPE', 'KPE', 'SLE', 'BKE', 'KJE', 'MCE', 'NSC']);

// "JALAN BOON LAY" -> "Jalan Boon Lay", "JURONG TOWN HALL RD" -> "Jurong Town Hall Rd", "PIE/AYE INTERCHANGE" -> "PIE/AYE Interchange"
const tidyPlace = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .map((w) => (w.split('/').every((part) => ROAD_CODES.has(part)) ? w : w[0] + w.slice(1).toLowerCase()))
    .join(' ');

export function groupStretches(records: LtaTravelTimeRecord[]): TravelRoute[] {
  const routes = new Map<string, TravelRoute>();
  for (const r of records) {
    if (!r?.Name || typeof r.EstTime !== 'number' || !r.StartPoint || !r.EndPoint) continue;
    const key = `${r.Name}-${r.Direction}`;
    if (!routes.has(key)) routes.set(key, { code: r.Name, direction: r.Direction, towards: tidyPlace(r.FarEndPoint || ''), stretches: [] });
    routes.get(key)!.stretches.push({ from: tidyPlace(r.StartPoint), to: tidyPlace(r.EndPoint), minutes: r.EstTime });
  }
  return [...routes.values()].sort((a, b) => a.code.localeCompare(b.code) || a.direction - b.direction);
}

/** Minutes from one point to a later one along a route, or null if they aren't in that order. */
export function minutesBetween(route: TravelRoute, from: string, to: string): number | null {
  // Case-insensitive, so saved commutes survive changes in how place names are written.
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const start = route.stretches.findIndex((s) => same(s.from, from));
  if (start < 0) return null;
  let minutes = 0;
  for (let i = start; i < route.stretches.length; i++) {
    minutes += route.stretches[i].minutes;
    if (same(route.stretches[i].to, to)) return minutes;
  }
  return null;
}

export function sumTravelTimes(records: LtaTravelTimeRecord[]): Record<string, DirectionTravelTime[]> {
  const totals = new Map<string, { code: string; direction: number; towards: string; minutes: number }>();
  for (const r of records) {
    if (!r?.Name || typeof r.EstTime !== 'number') continue;
    const key = `${r.Name}-${r.Direction}`;
    if (!totals.has(key)) {
      totals.set(key, { code: r.Name, direction: r.Direction, towards: tidyPlace(r.FarEndPoint || ''), minutes: 0 });
    }
    totals.get(key)!.minutes += r.EstTime;
  }

  const byCode: Record<string, DirectionTravelTime[]> = {};
  for (const t of [...totals.values()].sort((a, b) => a.direction - b.direction)) {
    (byCode[t.code] ||= []).push({ towards: t.towards, minutes: t.minutes });
  }
  return byCode;
}

// LTA refreshes travel times every 5 minutes.
const TRAVEL_TIME_POLL_MS = 2 * 60_000;

export function useLtaTravelTimes() {
  const feed = usePolledJson<{ value: LtaTravelTimeRecord[] }>('/api/traveltimes', TRAVEL_TIME_POLL_MS, (d) => Array.isArray(d?.value));
  const byCode = useMemo(() => sumTravelTimes(feed.data?.value || []), [feed.data]);
  const routes = useMemo(() => groupStretches(feed.data?.value || []), [feed.data]);
  return { byCode, routes, status: feed.status, fetchedAt: feed.fetchedAt, refresh: feed.refresh };
}
