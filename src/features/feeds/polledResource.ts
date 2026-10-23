import { createSingleFlight } from '../../../shared/singleFlight';
import { FeedHttpError, type FeedResponse } from '../../utils/feedResponse';

export interface FeedState<T> {
  data: T | null;
  status: 'loading' | 'live' | 'error';
  fetchedAt: number | null;
  offline: boolean;
  refreshing: boolean;
}
export interface FeedOptions<T> {
  url: string;
  pollMs: number;
  isValid: (data: unknown) => data is T;
  isComplete?: (data: T) => boolean;
}
interface Dependencies {
  fetch: (url: string) => Promise<FeedResponse<unknown>>;
  now: () => number;
  retryMs: number;
  schedule: (run: () => void, ms: number) => () => void;
  onRefresh: (run: () => void) => () => void;
}

/** Retained, validated browser feed; scheduled work exists only while there are subscribers. */
export function createPolledResource<T>(options: FeedOptions<T>, deps: Dependencies) {
  let state: FeedState<T> = {
    data: null,
    status: 'loading',
    fetchedAt: null,
    offline: false,
    refreshing: false,
  };
  const subscribers = new Set<() => void>();
  const flight = createSingleFlight<void>(() => schedule());
  let nextPollAt = 0;
  let retryAt = 0;
  let failures = 0;
  let cancelTimer: (() => void) | undefined;
  let removeRefresh: (() => void) | undefined;
  const publish = (changes: Partial<FeedState<T>>) => {
    state = { ...state, ...changes };
    subscribers.forEach((fn) => fn());
  };
  const schedule = () => {
    cancelTimer?.();
    cancelTimer = undefined;
    if (subscribers.size && !flight.current)
      cancelTimer = deps.schedule(
        () => {
          void refresh();
        },
        Math.max(0, nextPollAt - deps.now(), retryAt - deps.now()),
      );
  };
  function refresh(): Promise<void> {
    if (flight.current) return flight.current;
    if (deps.now() < retryAt) {
      schedule();
      return Promise.resolve();
    }
    cancelTimer?.();
    cancelTimer = undefined;
    return flight.run(async () => {
      publish({ refreshing: true });
      try {
        const result = await deps.fetch(options.url);
        if (!options.isValid(result.data)) throw new Error('Unexpected feed response');
        failures = 0;
        retryAt = 0;
        // Offline copies must not replace a known network observation or renew its age.
        if (result.offline && state.data !== null) publish({ status: 'error' });
        else
          publish({
            data: result.data,
            fetchedAt: result.receivedAt,
            offline: result.offline,
            status: result.offline || options.isComplete?.(result.data) === false ? 'error' : 'live',
          });
      } catch (error) {
        failures += 1;
        retryAt = error instanceof FeedHttpError ? (error.retryAt ?? 0) : 0;
        publish({ status: state.status === 'loading' && failures < 2 ? 'loading' : 'error' });
      } finally {
        nextPollAt = deps.now() + (state.status === 'live' ? options.pollMs : deps.retryMs);
        publish({ refreshing: false });
      }
    });
  }
  function connect(listener: () => void) {
    subscribers.add(listener);
    if (subscribers.size === 1)
      removeRefresh = deps.onRefresh(() => {
        void refresh();
      });
    queueMicrotask(() => {
      if (!subscribers.has(listener)) return;
      if (deps.now() >= nextPollAt) void refresh();
      else schedule();
    });
    return () => {
      subscribers.delete(listener);
      if (!subscribers.size) {
        cancelTimer?.();
        cancelTimer = undefined;
        removeRefresh?.();
        removeRefresh = undefined;
      }
    };
  }
  return { connect, refresh, getSnapshot: () => state };
}
