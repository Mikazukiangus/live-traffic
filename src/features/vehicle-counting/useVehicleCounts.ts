import { useEffect, useRef, useState } from 'react';
import { config } from '../../../config/client';
import { backgroundOwner, getBackgroundQueue } from '../background/browserQueue';
import { countVehicles, vehicleCountingAllowed, VEHICLE_ANALYSIS_VERSION } from './engine';
import { createVehicleJobs, type VehicleCount, type VehicleCountStatus } from './vehicleJobs';
import { createVehicleCounter } from './countCache';
const counter = createVehicleCounter({ count: (url, signal) => countVehicles(url, signal), now: () => Date.now(),
  ttlMs: config.vehicleCache.ttlMs, maxEntries: config.vehicleCache.maxEntries, version: VEHICLE_ANALYSIS_VERSION });
/** In-memory only; clears completed counts and prevents old pending inference refilling them. */
export const clearVehicleCountCache = counter.clear;
export type { VehicleCount, VehicleCountStatus } from './vehicleJobs';

/** A count describes only the exact camera photo processed by the model. */
export function currentVehicleCount(counts: Record<string, VehicleCount>, id: string, imageUrl: string): VehicleCount | undefined {
  const result = counts[id];
  return result?.imageUrl === imageUrl ? result : undefined;
}

/** Current photos become bounded background tasks, with the visible/selected cameras first. */
export function useVehicleCounts(cameras: { id: string; imageUrl: string }[]) {
  const [state, setState] = useState<{ counts: Record<string, VehicleCount>; status: VehicleCountStatus }>({ counts: {}, status: 'idle' });
  const latest = useRef(cameras);
  latest.current = cameras;
  const jobs = useRef<ReturnType<typeof createVehicleJobs> | null>(null);
  useEffect(() => {
    const resource = createVehicleJobs({ queue: getBackgroundQueue(), owner: backgroundOwner('vehicles'),
      count: counter.count, cached: config.vehicleCache.ttlMs > 0 ? counter.read : undefined, retryMs: config.poll.retry, publish: setState });
    jobs.current = resource;
    const refresh = () => resource.update(latest.current, { enabled: vehicleCountingAllowed(), visible: document.visibilityState === 'visible' });
    refresh();
    document.addEventListener('visibilitychange', refresh);
    return () => { document.removeEventListener('visibilitychange', refresh); resource.dispose(); jobs.current = null; };
  }, []);
  useEffect(() => {
    jobs.current?.update(cameras, { enabled: vehicleCountingAllowed(), visible: document.visibilityState === 'visible' });
  }, [cameras]);
  return state;
}
