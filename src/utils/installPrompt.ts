import { useEffect, useState } from 'react';
import { createInstallPromptResource } from './installPromptResource';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Chrome fires this once, possibly before React mounts, so it is caught at module load.
const resource = createInstallPromptResource();
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  resource.offer(e as BeforeInstallPromptEvent);
});
window.addEventListener('appinstalled', () => resource.offer(null));

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;

// iPhone/iPad Safari has no install prompt; installing is Share → Add to Home Screen.
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** How this browser can install the app: a prompt (Chrome, Edge, Android), iOS instructions, or not at all. */
export function useInstallPrompt(): { mode: 'prompt' | 'ios' | null; install: () => Promise<void> } {
  const [, rerender] = useState(0);
  useEffect(() => {
    const l = () => rerender((n) => n + 1);
    return resource.subscribe(l);
  }, []);
  const install = resource.install;

  if (isStandalone()) return { mode: null, install };
  if (resource.available()) return { mode: 'prompt', install };
  return { mode: isIos() ? 'ios' : null, install };
}
