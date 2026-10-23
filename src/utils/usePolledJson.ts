import { useMemo, useRef } from 'react';
import { createBrowserFeed, useSharedFeed } from '../features/feeds/useSharedFeed';

export interface Polled<T> {
  data: T | null;
  status: 'loading' | 'live' | 'error';
  fetchedAt: number | null;
  refresh: () => Promise<void>;
}

/** A URL owns its snapshot and pending work; old completions cannot publish into a new view. */
export function usePolledJson<T>(
  url: string, pollMs: number,
  isComplete: (data: T) => boolean = () => true,
  isValid: (data: T) => boolean = isComplete,
): Polled<T> {
  const complete = useRef(isComplete), valid = useRef(isValid);
  complete.current = isComplete;
  valid.current = isValid;
  const resource = useMemo(() => createBrowserFeed<T>({
    url, pollMs,
    isValid: (data): data is T => valid.current(data as T),
    isComplete: data => complete.current(data),
  }), [url, pollMs]);
  return useSharedFeed(resource);
}
