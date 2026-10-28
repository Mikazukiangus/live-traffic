import { createSingleFlight } from '../../shared/singleFlight';
import { logger } from '../../shared/logging';
export interface InstallPrompt {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
/** Consume a one-shot browser event before awaiting; old work cannot clear a new event. */
export function createInstallPromptResource() {
  let deferred: InstallPrompt | null = null;
  const listeners = new Set<() => void>();
  const flight = createSingleFlight<void>();
  const publish = () => listeners.forEach(fn => fn());
  return {
    offer(event: InstallPrompt | null) { deferred = event; publish(); },
    available: () => deferred !== null,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    install() {
      return flight.run(async () => {
        const event = deferred;
        if (!event) return;
        deferred = null;
        publish();
        try { await event.prompt(); await event.userChoice; }
        catch {
          // Never log the browser event, choice or raw exception.
          logger.warn({ event: 'install_prompt_failure', code: 'INSTALL_PROMPT_FAILED' });
        }
      });
    },
  };
}
