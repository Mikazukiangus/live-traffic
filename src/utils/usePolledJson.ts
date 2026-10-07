import { useCallback, useEffect, useRef, useState } from 'react';

const RETRY_MS = 30_000;

export interface Polled<T> {
  data: T | null;
  status: 'loading' | 'live' | 'error';
  // When the last good answer arrived (ms)
  fetchedAt: number | null;
  refresh: () => Promise<void>;
}

/**
 * Polls a JSON endpoint. Until a complete answer arrives it retries every 30 seconds (the keyless
 * data.gov.sg feeds rate-limit bursts); after that it polls every `pollMs`. A failed poll keeps
 * the last good data and reports 'error'.
 */
export function usePolledJson<T>(url: string, pollMs: number, isComplete: (data: T) => boolean = () => true): Polled<T> {
  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<Polled<T>['status']>('loading');
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const complete = useRef(false);
  const failures = useRef(0);
  const isCompleteRef = useRef(isComplete);
  isCompleteRef.current = isComplete;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as T;
      setData(json);
      setFetchedAt(Date.now());
      setStatus('live');
      complete.current = isCompleteRef.current(json);
      failures.current = 0;
    } catch {
      // data.gov.sg often rate-limits the first burst on page load, so a feed that has never
      // answered counts as still loading after one failure and as down after two.
      failures.current += 1;
      setStatus((prev) => (prev === 'loading' && failures.current < 2 ? 'loading' : 'error'));
    }
  }, [url]);

  useEffect(() => {
    let retry: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      await refresh();
      if (!complete.current) retry = setTimeout(load, RETRY_MS);
    };
    load();
    const interval = setInterval(() => complete.current && refresh(), pollMs);
    return () => {
      clearInterval(interval);
      clearTimeout(retry);
    };
  }, [refresh, pollMs]);

  return { data, status, fetchedAt, refresh };
}
