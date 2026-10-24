import type { HistoryReceipt } from './commuteRepository';
import type { BackgroundQueue, TaskHandle } from '../background/taskQueue';

/** Defer optional trend receipts after render; user save/delete/alert mutations remain foreground. */
export function createHistoryJobs(queue: BackgroundQueue, owner: string, record: (rows: HistoryReceipt[]) => void | Promise<void>, notice: (text: string | null) => void = () => {}) {
  let active = true;
  const jobs = new Set<TaskHandle<void>>();
  return {
    record(rows: HistoryReceipt[]) {
      if (!active || !rows.length) return;
      const copy = structuredClone(rows);
      const handle = queue.enqueue({ lane: 'history', key: `${owner}:${JSON.stringify(copy)}`,
        run: async signal => { signal.throwIfAborted(); await record(copy); } });
      jobs.add(handle);
      void handle.result.then(result => {
        jobs.delete(handle);
        if (!active || result.state === 'cancelled') return;
        notice(result.state === 'done' ? null : 'Recent travel-time history could not be recorded. It will resume with new live readings.');
      });
    },
    dispose() { active = false; jobs.forEach(job => job.cancel()); jobs.clear(); },
  };
}
