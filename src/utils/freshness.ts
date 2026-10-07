import { useEffect, useState } from 'react';

/** Milliseconds for an LTA/NEA timestamp, e.g. "2026-10-07 14:05:00" (SGT) or "2026-10-07T14:00:00+08:00". */
export function parseSgt(timestamp: string | null | undefined): number | null {
  if (!timestamp) return null;
  let iso = timestamp.trim().replace(' ', 'T');
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(iso)) iso += '+08:00';
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** "14:05" in Singapore time. */
export const sgtClock = (ms: number) =>
  new Date(ms).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Singapore' });

/** The current time, ticking every `everyMs`, so ages and staleness re-evaluate on their own. */
export function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(interval);
  }, [everyMs]);
  return now;
}

/** False while the browser reports no network connection. */
export function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export interface StaleFeed {
  /** e.g. "LTA speed bands" */
  label: string;
  /** e.g. "from 14:05 SGT, feed not responding" */
  detail: string;
}
