import { isRainForecast, type RainForecast } from '../../../shared/weather/rain';
import { parseSgt } from '../../../shared/time';
import { FeedHttpError, type FeedResponse } from '../../utils/feedResponse';

export interface RainState {
  data: RainForecast | null;
  status: 'loading' | 'live' | 'error';
  fetchedAt: number | null;
  refreshing: boolean;
}
interface Dependencies {
  fetch: (url: string) => Promise<FeedResponse<unknown>>;
  now: () => number;
  pollMs: number;
  retryMs: number;
  schedule: (run: () => void, ms: number) => () => void;
  onRefresh: (run: () => void) => () => void;
}
/** One timer, listener, pending request and retained observation for all mounted rain consumers. */
export function createRainResource(deps: Dependencies) {
  let state: RainState = { data: null, status: 'loading', fetchedAt: null, refreshing: false };
  const subscribers = new Set<() => void>();
  let pending: Promise<void> | null = null;
  let retryAt = 0;
  let nextPollAt = 0;
  let cancelTimer: (() => void) | undefined;
  let removeRefresh: (() => void) | undefined;
  const publish = (changes: Partial<RainState>) => {
    state = { ...state, ...changes };
    subscribers.forEach((fn) => fn());
  };
  const schedule = () => {
    cancelTimer?.();
    cancelTimer = undefined;
    if (subscribers.size && !pending)
      cancelTimer = deps.schedule(
        () => {
          void refresh();
        },
        Math.max(0, nextPollAt - deps.now(), retryAt - deps.now()),
      );
  };
  function refresh(): Promise<void> {
    if (pending) return pending;
    if (retryAt > deps.now()) {
      schedule();
      return Promise.resolve();
    }
    cancelTimer?.();
    cancelTimer = undefined;
    publish({ refreshing: true });
    pending = (async () => {
      try {
        const result = await deps.fetch('/api/rainforecast');
        if (!isRainForecast(result.data)) throw new Error('Unexpected forecast');
        retryAt = result.data.delivery?.retryAt ?? 0;
        // Offline responses cannot renew the last successful observation's age.
        if (result.offline && state.data) publish({ status: 'error' });
        else
          publish({
            data: result.data,
            fetchedAt: parseSgt(result.data.delivery?.fetchedAt) ?? result.receivedAt,
            status: result.offline || result.data.delivery?.state === 'retained' ? 'error' : 'live',
          });
      } catch (error) {
        retryAt = error instanceof FeedHttpError ? (error.retryAt ?? 0) : 0;
        publish({ status: 'error' });
      }
    })().finally(() => {
      pending = null;
      nextPollAt = deps.now() + (state.status === 'live' ? deps.pollMs : deps.retryMs);
      publish({ refreshing: false });
      schedule();
    });
    return pending;
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
