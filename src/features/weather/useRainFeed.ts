import { useSyncExternalStore } from 'react';
import { config } from '../../../config/client';
import { fetchFeed } from '../../utils/feedResponse';
import { createRainResource } from './rainResource';

const rain = createRainResource({
  fetch: fetchFeed,
  now: Date.now,
  pollMs: config.poll.rain,
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
export function useRainFeed() {
  const state = useSyncExternalStore(rain.connect, rain.getSnapshot);
  return { ...state, refresh: rain.refresh };
}
