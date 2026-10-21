import { useSyncExternalStore } from 'react';
import { config } from '../../../config/client';
import { fetchFeed } from '../../utils/feedResponse';
import { createPolledResource, type FeedOptions } from './polledResource';

/** Construct once at module scope; browser effects are installed only on subscription. */
export function createBrowserFeed<T>(options: FeedOptions<T>) {
  return createPolledResource(options, {
    fetch: fetchFeed,
    now: Date.now,
    retryMs: config.poll.retry,
    schedule: (run, ms) => {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    },
    onRefresh: (run) => {
      window.addEventListener('trafficpulse:refresh', run);
      return () => window.removeEventListener('trafficpulse:refresh', run);
    },
  });
}

export function useSharedFeed<T>(resource: ReturnType<typeof createPolledResource<T>>) {
  const state = useSyncExternalStore(resource.connect, resource.getSnapshot);
  return { ...state, refresh: resource.refresh };
}
