export type TaskLane = 'analysis' | 'history' | 'notifications';
export type TaskResult<T> = { state: 'done'; value: T } | { state: 'cancelled' | 'expired' | 'full' | 'failed' };
export interface TaskHandle<T> { result: Promise<TaskResult<T>>; cancel: () => void; prioritize: (priority: number) => void }
export interface BackgroundTask<T> {
  lane: TaskLane;
  key: string;
  run: (signal: AbortSignal) => T | Promise<T>;
  priority?: number;
  expiresAt?: number;
  // Callers opt in only for idempotent work. Delivery/mutations have no automatic retry.
  retry?: { maxAttempts: number; delayMs: number };
}
interface Ports {
  now: () => number;
  maxPending: number;
  maxAgeMs: number;
  defer: (run: () => void, urgent: boolean) => () => void;
  schedule: (run: () => void, ms: number) => () => void;
  failed: (lane: TaskLane, state: 'expired' | 'full' | 'failed') => void;
}
interface Entry {
  lane: TaskLane; key: string; priority: number; order: number; expiresAt: number;
  run: BackgroundTask<unknown>['run']; retry?: BackgroundTask<unknown>['retry'];
  controller: AbortController; attempts: number; running: boolean; waiting: boolean; settled: boolean;
  reason: 'cancelled' | 'expired'; expiry?: () => void; delay?: () => void;
  resolve: (value: TaskResult<unknown>) => void; handle: TaskHandle<unknown>;
}
const LANES: TaskLane[] = ['notifications', 'history', 'analysis'];

/** Bounded page-lifetime work: one physical operation per lane, independent of other lanes. */
export function createBackgroundQueue(ports: Ports) {
  const entries = new Set<Entry>();
  const indexed = new Map<string, Entry>();
  const running = { analysis: 0, history: 0, notifications: 0 };
  let active = true, sequence = 0;
  let deferred: (() => void) | undefined;
  let deferredUrgent = false;
  const identity = (lane: TaskLane, key: string) => `${lane}:${key}`;
  const finish = (entry: Entry, result: TaskResult<unknown>) => {
    if (entry.settled) return;
    entry.settled = true;
    entry.expiry?.(); entry.delay?.();
    entries.delete(entry);
    const key = identity(entry.lane, entry.key);
    if (indexed.get(key) === entry) indexed.delete(key);
    if (result.state === 'expired' || result.state === 'full' || result.state === 'failed') ports.failed(entry.lane, result.state);
    entry.resolve(result);
  };
  const cancel = (entry: Entry, reason: 'cancelled' | 'expired') => {
    if (entry.settled || entry.controller.signal.aborted) return;
    entry.reason = reason;
    entry.controller.abort();
    // Keep the physical lane occupied until started work actually stops.
    if (!entry.running) finish(entry, { state: reason });
  };
  const ready = () => LANES.some(lane => !running[lane] && [...entries].some(e => e.lane === lane && e.waiting && !e.settled));
  const wake = () => {
    if (!active || !ready()) return;
    const urgent = [...entries].some(e => e.lane === 'notifications' && e.waiting);
    if (deferred && (deferredUrgent || !urgent)) return;
    deferred?.();
    deferredUrgent = urgent;
    deferred = ports.defer(pump, urgent);
  };
  async function execute(entry: Entry) {
    entry.waiting = false;
    entry.running = true;
    running[entry.lane]++;
    entry.attempts++;
    try {
      const value = await entry.run(entry.controller.signal);
      if (entry.controller.signal.aborted) finish(entry, { state: entry.reason });
      else if (ports.now() >= entry.expiresAt) finish(entry, { state: 'expired' });
      else finish(entry, { state: 'done', value });
    } catch {
      if (entry.controller.signal.aborted) finish(entry, { state: entry.reason });
      else if (entry.retry && entry.attempts < entry.retry.maxAttempts && ports.now() + entry.retry.delayMs < entry.expiresAt) {
        entry.delay = ports.schedule(() => { entry.delay = undefined; entry.waiting = true; wake(); }, entry.retry.delayMs);
      } else finish(entry, { state: ports.now() >= entry.expiresAt ? 'expired' : 'failed' });
    } finally {
      entry.running = false;
      running[entry.lane]--;
      wake();
    }
  }
  function pump() {
    deferred = undefined;
    if (!active) return;
    for (const lane of LANES) {
      if (running[lane]) continue;
      const next = [...entries].filter(e => e.lane === lane && e.waiting && !e.settled)
        .sort((a, b) => a.priority - b.priority || a.order - b.order)[0];
      if (!next) continue;
      if (ports.now() >= next.expiresAt) { cancel(next, 'expired'); continue; }
      void execute(next);
    }
    wake();
  }
  return {
    enqueue<T>(task: BackgroundTask<T>): TaskHandle<T> {
      const key = identity(task.lane, task.key);
      const existing = indexed.get(key);
      if (existing && !existing.controller.signal.aborted) return existing.handle as TaskHandle<T>;
      const immediate = (state: 'full' | 'cancelled' | 'expired'): TaskHandle<T> => ({ result: Promise.resolve({ state }), cancel() {}, prioritize() {} });
      if (!active) return immediate('cancelled');
      if ([...entries].filter(e => !e.running).length >= ports.maxPending) { ports.failed(task.lane, 'full'); return immediate('full'); }
      const expiresAt = Math.min(task.expiresAt ?? Infinity, ports.now() + ports.maxAgeMs);
      if (expiresAt <= ports.now()) { ports.failed(task.lane, 'expired'); return immediate('expired'); }
      let resolve!: Entry['resolve'];
      const result = new Promise<TaskResult<unknown>>(yes => { resolve = yes; });
      const entry: Entry = { ...task, expiresAt, priority: task.priority ?? 0, order: sequence++, run: task.run,
        controller: new AbortController(), attempts: 0, running: false, waiting: true, settled: false, reason: 'cancelled', resolve,
        handle: { result, cancel: () => cancel(entry, 'cancelled'), prioritize: priority => { entry.priority = priority; wake(); } } };
      entries.add(entry);
      indexed.set(key, entry);
      entry.expiry = ports.schedule(() => cancel(entry, 'expired'), Math.max(0, expiresAt - ports.now()));
      wake();
      return entry.handle as TaskHandle<T>;
    },
    stats: () => ({ waiting: [...entries].filter(e => !e.running).length, running: { ...running } }),
    dispose() { active = false; deferred?.(); deferred = undefined; [...entries].forEach(e => cancel(e, 'cancelled')); },
  };
}
export type BackgroundQueue = ReturnType<typeof createBackgroundQueue>;
