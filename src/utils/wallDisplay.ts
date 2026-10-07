import { useEffect, useRef, useState } from 'react';
import { useUrlParam, writeParams } from './urlState';

/**
 * Wall display (?display=wall): no menus, full screen where allowed, and pages cycle through
 * their tabs on their own, for a screen in an operations room.
 */
export const WALL_CYCLE_MS = 30_000;

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
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const take = async () => {
      if (document.visibilityState !== 'visible' || (lock && !lock.released)) return;
      try {
        lock = await navigator.wakeLock.request('screen');
        if (cancelled) {
          lock.release().catch(() => {});
          return;
        }
        setHeld(true);
        lock.addEventListener('release', () => setHeld(false));
      } catch {
        // Refused (e.g. battery saver); the screen may sleep
        setHeld(false);
      }
    };
    take();
    document.addEventListener('visibilitychange', take);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', take);
      lock?.release().catch(() => {});
      setHeld(false);
    };
  }, [enabled]);
  return held;
}
