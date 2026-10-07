import { useEffect, useRef } from 'react';

/**
 * App-wide actions that start in one place (pull to refresh, the R key) and are carried out by
 * whichever page is showing.
 */
const REFRESH = 'trafficpulse:refresh';

export const requestRefresh = () => window.dispatchEvent(new Event(REFRESH));

export function useRefreshRequests(onRefresh: () => void) {
  const handler = useRef(onRefresh);
  handler.current = onRefresh;
  useEffect(() => {
    const run = () => handler.current();
    window.addEventListener(REFRESH, run);
    return () => window.removeEventListener(REFRESH, run);
  }, []);
}

/** True when a key press is meant for a form field, so shortcuts leave it alone. */
export const isTypingTarget = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
};

/** A keyboard shortcut handler that ignores typing and modifier combinations. */
export function useShortcuts(handlers: Record<string, () => void>, enabled = true) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e)) return;
      const fn = ref.current[e.key] || ref.current[e.key.toLowerCase()];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
