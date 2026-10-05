import { useEffect, useState } from 'react';
import { CongestionStatus } from '../types/traffic';

export interface ExpresswaySpeed {
  code: string;
  avgSpeedKmH: number;
  status: CongestionStatus;
}

// LTA speed bands refresh every 5 minutes; /api/expresswayspeeds is CDN-cached for that window.
const SPEEDS_POLL_MS = 60_000;

/** Live LTA average speed per expressway (summary only, without map segments). */
export function useExpresswaySpeeds() {
  const [byCode, setByCode] = useState<Record<string, ExpresswaySpeed>>({});
  const [status, setStatus] = useState<'loading' | 'live' | 'error'>('loading');

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/expresswayspeeds');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!Array.isArray(json?.expressways) || json.expressways.length === 0) throw new Error('No speeds');
        setByCode(Object.fromEntries(json.expressways.map((e: ExpresswaySpeed) => [e.code, e])));
        setStatus('live');
      } catch {
        // Keep the last live speeds, if any
        setStatus('error');
      }
    };
    load();
    const interval = setInterval(load, SPEEDS_POLL_MS);
    return () => clearInterval(interval);
  }, []);

  return { byCode, status };
}

/** "64 km/h • Smooth", or a loading/unavailable message. */
export function describeExpresswaySpeed(speeds: ReturnType<typeof useExpresswaySpeeds>, code: string): string {
  const s = speeds.byCode[code];
  if (s) return `${s.avgSpeedKmH} km/h • ${s.status}`;
  return speeds.status === 'loading' ? 'Loading LTA speed…' : 'LTA speed unavailable';
}
