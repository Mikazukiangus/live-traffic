import { config } from '../../config/client';
import { useEffect, useRef, useState } from 'react';
import { useUrlParam, writeParams } from './urlState';
import { createWakeLockResource } from './wakeLockResource';

/**
 * Wall display (?display=wall): no menus, full screen where allowed, and pages cycle through
 * their tabs on their own, for a screen in an operations room.
 */
export const WALL_CYCLE_MS = config.wallCycleMs;

export function useWallDisplay() {
  const [display] = useUrlParam('display');
  return display === 'wall';
}

export function enterWallDisplay() {
  writeParams({ display: 'wall' }, true);
  document.documentElement.requestFullscreen?.().catch(() => {
    // Full screen refused (e.g. iframe); wall display still works in the window
  });
}

export function exitWallDisplay() {
  writeParams({ display: null });
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}

/** Calls `next` every 30 seconds while the wall display is on. */
export function useWallCycle(wall: boolean, next: () => void) {
  // Kept in a ref so re-renders (every data poll) don't restart the 30-second timer.
  const nextRef = useRef(next);
  nextRef.current = next;
  useEffect(() => {
    if (!wall) return;
    const interval = setInterval(() => nextRef.current(), WALL_CYCLE_MS);
    return () => clearInterval(interval);
  }, [wall]);
}

/**
 * Keeps the screen on while `enabled` (Screen Wake Lock API). The browser drops the lock when the
 * tab is hidden, so it is taken again on return. Returns whether a lock is held right now, or null
 * where the browser has no wake lock.
 */
export function useWakeLock(enabled: boolean) {
  const [held, setHeld] = useState<boolean | null>(() => ('wakeLock' in navigator ? false : null));
  useEffect(() => {
    if (!enabled || !('wakeLock' in navigator)) return;
    const resource = createWakeLockResource({
      request: () => navigator.wakeLock.request('screen'),
      visible: () => document.visibilityState === 'visible',
      held: setHeld,
    });
    const take = () => { void resource.take(); };
    take();
    document.addEventListener('visibilitychange', take);
    return () => {
      document.removeEventListener('visibilitychange', take);
      resource.dispose();
    };
  }, [enabled]);
  return held;
}
