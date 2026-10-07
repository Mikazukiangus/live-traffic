import { useEffect, useRef } from 'react';
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
