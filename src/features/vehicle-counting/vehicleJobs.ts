import type { BackgroundQueue, TaskHandle } from '../background/taskQueue';

export interface VehicleCount { count: number; imageUrl: string }
export type VehicleCountStatus = 'idle' | 'counting' | 'ready' | 'off' | 'error';
interface Camera { id: string; imageUrl: string }
interface State { counts: Record<string, VehicleCount>; status: VehicleCountStatus }
interface Ports {
  queue: BackgroundQueue; owner: string;
  count: (url: string, signal: AbortSignal) => Promise<number>;
  retryMs: number;
  cached?: (url: string) => number | undefined;
  publish: (state: State) => void;
}
/** Latest-photo jobs only; inference stays in the existing on-device ONNX worker. */
export function createVehicleJobs(ports: Ports) {
  let active = true, enabled = true, visible = true;
  let desired = new Map<string, string>();
  let counts: Record<string, VehicleCount> = {};
  const failed = new Map<string, string>();
  const jobs = new Map<string, { imageUrl: string; handle: TaskHandle<number> }>();
  const publish = () => {
    if (!active) return;
    const hasFailure = [...desired].some(([id, url]) => failed.get(id) === url);
    ports.publish({ counts, status: !enabled ? 'off' : !visible ? 'idle' : jobs.size ? 'counting' : hasFailure ? 'error' : desired.size ? 'ready' : 'idle' });
  };
  return {
    update(cameras: readonly Camera[], options: { enabled: boolean; visible: boolean }) {
      if (!active) return;
      enabled = options.enabled; visible = options.visible;
      desired = new Map(cameras.map(c => [c.id, c.imageUrl]));
      counts = Object.fromEntries(Object.entries(counts).filter(([id]) => desired.has(id)));
      for (const [id, url] of failed) if (desired.get(id) !== url) failed.delete(id);
      for (const [id, job] of jobs) {
        if (!enabled || !visible || desired.get(id) !== job.imageUrl) { job.handle.cancel(); jobs.delete(id); }
      }
      if (enabled && visible) cameras.forEach((camera, priority) => {
        const existing = jobs.get(camera.id);
        if (existing) { existing.handle.prioritize(priority); return; }
        if (ports.cached) {
          const count = ports.cached(camera.imageUrl);
          if (count !== undefined) {
            failed.delete(camera.id);
            counts = { ...counts, [camera.id]: { count, imageUrl: camera.imageUrl } };
            return;
          }
          // Expiry/invalidation can require reanalysis even when the photo URL is unchanged.
          if (counts[camera.id]) { counts = { ...counts }; delete counts[camera.id]; }
        } else if (counts[camera.id]?.imageUrl === camera.imageUrl) return;
        if (failed.get(camera.id) === camera.imageUrl) return;
        const handle = ports.queue.enqueue({ lane: 'analysis', key: `${ports.owner}:${camera.id}:${camera.imageUrl}`, priority,
          retry: { maxAttempts: 2, delayMs: ports.retryMs },
          run: async signal => {
            signal.throwIfAborted();
            const value = await ports.count(camera.imageUrl, signal);
            if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid vehicle count');
            return value;
          } });
        const job = { imageUrl: camera.imageUrl, handle };
        jobs.set(camera.id, job);
        void handle.result.then(result => {
          if (!active || jobs.get(camera.id) !== job) return;
          jobs.delete(camera.id);
          if (enabled && visible && desired.get(camera.id) === camera.imageUrl) {
            if (result.state === 'done') counts = { ...counts, [camera.id]: { count: result.value, imageUrl: camera.imageUrl } };
            else if (result.state !== 'cancelled') failed.set(camera.id, camera.imageUrl);
          }
          publish();
        });
      });
      publish();
    },
    dispose() { active = false; jobs.forEach(job => job.handle.cancel()); jobs.clear(); },
  };
}
