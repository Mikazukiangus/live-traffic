/**
 * LTA DataMall EstTravelTimes, summed per expressway and direction.
 * Each record is one stretch, e.g. { Name: 'PIE', Direction: 2, FarEndPoint: 'CHANGI AIRPORT', EstTime: 3 },
 * so adding a direction's stretches gives the end-to-end time. LTA does not publish KPE or MCE.
 */
import { useCallback, useEffect, useState } from 'react';

interface LtaTravelTimeRecord {
  Name: string;
  Direction: number;
  FarEndPoint: string;
  EstTime: number;
}

export interface DirectionTravelTime {
  towards: string;
  minutes: number;
}

// "CHANGI AIRPORT" -> "Changi Airport"; road codes such as "PIE/AYE" stay upper case.
const tidyPlace = (name: string) =>
  name
    .split(' ')
    .map((w) => (/^[A-Z]{4,}$/.test(w) ? w[0] + w.slice(1).toLowerCase() : w))
    .join(' ');

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
  const [byCode, setByCode] = useState<Record<string, DirectionTravelTime[]>>({});
  const [status, setStatus] = useState<'loading' | 'live' | 'error'>('loading');

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/traveltimes');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!Array.isArray(json?.value)) throw new Error('Unexpected travel times payload');
      setByCode(sumTravelTimes(json.value));
      setStatus('live');
    } catch {
      // Keep the last live times
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, TRAVEL_TIME_POLL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  return { byCode, status, refresh };
}
