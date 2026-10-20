import { useCallback, useSyncExternalStore } from 'react';
import { config } from '../../../config/client';
import { fetchFeed } from '../../utils/feedResponse';
import { loadSpeedSnapshot, saveSpeedSnapshot } from '../../utils/speedSnapshot';
import { createSpeedResource, type SpeedDemand } from './speedResource';

const speeds = createSpeedResource({
  fetch: fetchFeed,
  load: loadSpeedSnapshot,
  save: saveSpeedSnapshot,
  now: Date.now,
  pollMs: config.poll.live,
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
export function useSpeedFeed(demand: SpeedDemand = 'summary') {
  const subscribe = useCallback((listener: () => void) => speeds.connect(listener, demand), [demand]);
  const state = useSyncExternalStore(subscribe, speeds.getSnapshot);
  return { ...state, refresh: speeds.refresh };
}
