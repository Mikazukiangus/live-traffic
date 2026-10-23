import { createSingleFlight } from '../../shared/singleFlight';

type Lock = Pick<WakeLockSentinel, 'released' | 'release' | 'addEventListener'>;
interface Ports { request: () => Promise<Lock>; visible: () => boolean; held: (value: boolean) => void }
const release = (lock: Lock) => { void lock.release().catch(() => {}); };

/** One request owns acquisition; late results/release events cannot change a new owner's state. */
export function createWakeLockResource(ports: Ports) {
  let active = true;
  let current: Lock | null = null;
  const flight = createSingleFlight<void>();
  return {
    take() {
      if (!active || !ports.visible() || (current && !current.released)) return Promise.resolve();
      return flight.run(async () => {
        try {
          const lock = await ports.request();
          if (!active || !ports.visible() || lock.released) { release(lock); return; }
          current = lock;
          lock.addEventListener('release', () => {
            if (!active || current !== lock) return;
            current = null;
            ports.held(false);
          });
          ports.held(true);
        } catch { if (active) ports.held(false); }
      });
    },
    dispose() {
      if (!active) return;
      active = false;
      const lock = current;
      current = null;
      if (lock) release(lock);
      ports.held(false);
    },
  };
}
