import { EXPRESSWAY_CORRIDORS } from '../../data/expressways';
import { config } from '../../../config/client';
import { COMMUTE_LOCK_NAME, COMMUTE_STATE_KEY, createCoordinatedCommutes } from './coordinatedCommutes';

let repository: ReturnType<typeof createCoordinatedCommutes> | undefined;
/** Lazy browser adapter; tests can construct the same repository with isolated storage and a clock. */
export function getCommuteRepository() {
  return (repository ??= createCoordinatedCommutes({
    storage: () => localStorage,
    exclusive: typeof navigator !== 'undefined' && navigator.locks
      ? work => navigator.locks.request(COMMUTE_LOCK_NAME, { mode: 'exclusive', signal: AbortSignal.timeout(config.timeouts.request) }, work)
      : undefined,
    now: Date.now,
    onChange: refresh => {
      const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === COMMUTE_STATE_KEY) refresh(); };
      const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
      window.addEventListener('storage', onStorage);
      document.addEventListener('visibilitychange', onVisible);
      return () => { window.removeEventListener('storage', onStorage); document.removeEventListener('visibilitychange', onVisible); };
    },
  }, new Set(EXPRESSWAY_CORRIDORS.map(c => c.code))));
}
