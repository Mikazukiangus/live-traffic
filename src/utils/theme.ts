import { useSyncExternalStore } from 'react';

/** Light / dark / follow the device. Applied as html[data-theme]; index.html sets it before first paint. */
export type ThemeChoice = 'auto' | 'light' | 'dark';

const KEY = 'trafficpulse.theme';

const read = (): ThemeChoice => {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : 'auto';
  } catch {
    return 'auto';
  }
};

let choice = read();
const listeners = new Set<() => void>();

export function setTheme(next: ThemeChoice) {
  choice = next;
  try {
    if (next === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    // Storage blocked; the choice lasts until the page closes
  }
  if (next === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = next;
  listeners.forEach((l) => l());
}

export const useTheme = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => choice
  );

export const THEME_ORDER: ThemeChoice[] = ['auto', 'light', 'dark'];
export const THEME_LABEL: Record<ThemeChoice, { icon: string; label: string }> = {
  auto: { icon: 'brightness_auto', label: 'Theme: follows your device' },
  light: { icon: 'light_mode', label: 'Theme: light' },
  dark: { icon: 'dark_mode', label: 'Theme: dark' },
};
