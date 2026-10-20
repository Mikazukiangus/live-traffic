import { useEffect, useRef, useState } from 'react';
import { safeFailure } from '../../../shared/diagnostics.ts';
import { countVehicles, vehicleCountingAllowed } from './engine';
export interface VehicleCount {
  count: number;
  imageUrl: string; // the photo that was counted
}

export type VehicleCountStatus = 'idle' | 'counting' | 'ready' | 'off' | 'error';

/** A count only describes the specific camera photo processed by the model. */
export function currentVehicleCount(
  counts: Record<string, VehicleCount>,
  id: string,
  imageUrl: string,
): VehicleCount | undefined {
  const result = counts[id];
  return result?.imageUrl === imageUrl ? result : undefined;
}

/**
 * Counts vehicles in each camera's latest photo, one photo at a time, in the order given
 * (put the cameras on screen first). New photos are counted as they arrive; counting pauses
 * while the page is hidden and resumes on the next camera refresh.
 */
export function useVehicleCounts(cameras: { id: string; imageUrl: string }[]) {
  const [counts, setCounts] = useState<Record<string, VehicleCount>>({});
  const [status, setStatus] = useState<VehicleCountStatus>('idle');
  const latest = useRef(cameras);
  latest.current = cameras;
  const counted = useRef<Record<string, string>>({}); // camera id -> image URL already counted
  const running = useRef(false);
  const mounted = useRef(true);
  // Bumped when the page becomes visible again, so paused counting resumes straight away.
  const [visibleTick, setVisibleTick] = useState(0);

  useEffect(() => {
    mounted.current = true;
    const onVisible = () => document.visibilityState === 'visible' && setVisibleTick((t) => t + 1);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      mounted.current = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => {
    if (!vehicleCountingAllowed()) {
      setStatus('off');
      return;
    }
    if (running.current) return; // the running loop picks up new photos itself
    running.current = true;
    (async () => {
      let failed = false;
      while (mounted.current && document.visibilityState !== 'hidden') {
        const next = latest.current.find((c) => counted.current[c.id] !== c.imageUrl);
        if (!next) break;
        setStatus((s) => (s === 'ready' ? s : 'counting'));
        try {
          const count = await countVehicles(next.imageUrl);
          if (mounted.current) setCounts((prev) => ({ ...prev, [next.id]: { count, imageUrl: next.imageUrl } }));
        } catch (err) {
          console.warn(JSON.stringify(safeFailure('vehicle', err).log));
          failed = true;
        }
        counted.current[next.id] = next.imageUrl;
      }
      running.current = false;
      if (mounted.current) setStatus(failed ? 'error' : 'ready');
    })();
  }, [cameras, visibleTick]);

  return { counts, status };
}
