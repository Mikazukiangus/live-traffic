import { config } from '../../../config/client';
import { createBackgroundQueue, type BackgroundQueue } from './taskQueue';
import { logger } from '../../../shared/logging';

let queue: BackgroundQueue | undefined;
let owners = 0;
export const backgroundOwner = (kind: string) => `${kind}:${++owners}`;
/** Lazy page-local queue. Idle turns defer optional work; notification attempts start promptly. */
export function getBackgroundQueue() {
  return queue ??= createBackgroundQueue({
    now: Date.now, maxPending: config.background.maxPending, maxAgeMs: config.background.maxAgeMs,
    schedule: (run, ms) => { const timer = setTimeout(run, ms); return () => clearTimeout(timer); },
    defer: (run, urgent) => {
      if (!urgent && typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        const id = window.requestIdleCallback(run, { timeout: config.background.idleTimeoutMs });
        return () => window.cancelIdleCallback(id);
      }
      const timer = setTimeout(run, 0);
      return () => clearTimeout(timer);
    },
    failed: (lane, state) => logger.warn({ event: 'background_job_failure', lane, code: state === 'full' ? 'QUEUE_FULL' : state === 'expired' ? 'JOB_EXPIRED' : 'JOB_FAILED' }),
  });
}
