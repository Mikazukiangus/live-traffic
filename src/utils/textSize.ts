import { useSyncExternalStore } from 'react';

/**
 * Larger text (and with it, larger buttons): everything is sized in rem, so raising the root font
 * size scales the whole page. Applied as html[data-text="large"]; index.html sets it before first paint.
 */
const KEY = 'trafficpulse.textSize';

const read = () => {
  try {
    return localStorage.getItem(KEY) === 'large';
  } catch {
    return false;
  }
};

let large = read();
const listeners = new Set<() => void>();

export function setLargeText(next: boolean) {
  large = next;
  try {
    if (next) localStorage.setItem(KEY, 'large');
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked; the choice lasts until the page closes
  }
  if (next) document.documentElement.dataset.text = 'large';
  else delete document.documentElement.dataset.text;
  listeners.forEach((l) => l());
}

export const useLargeText = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => large
  );
