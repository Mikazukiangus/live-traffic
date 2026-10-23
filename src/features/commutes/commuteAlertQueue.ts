import type { DeliveryOutcome } from './notificationDelivery';
import { reportNotificationFailure } from '../../../shared/applicationDiagnostics';

export interface AlertCandidate { key: string; title: string; body: string }
export interface AlertDispatch { signal: AbortSignal; key: string; expiresAt: number }
interface Entry {
  candidate: AlertCandidate;
  attempts: number;
  expiresAt: number;
  state: 'pending' | 'retrying' | 'failed' | 'blocked' | 'unsupported';
  cancel?: () => void;
  controller: AbortController;
}
interface Dependencies {
  send: (title: string, body: string, context: AlertDispatch) => Promise<DeliveryOutcome>;
  now: () => number;
  schedule: (run: () => void, ms: number) => () => void;
  onNotice: (notice: string | null) => void;
}
const RETRY_MS = 15000;
const MAX_ATTEMPTS = 3;
const MAX_AGE_MS = 120000;

/** In-memory receipts belong to this tab. Retry only still-active, watched incidents. */
export function createCommuteAlertQueue(deps: Dependencies) {
  let baseline = false, active = true;
  const ignored = new Set<string>();
  const sent = new Set<string>();
  const entries = new Map<string, Entry>();
  const publish = () => {
    const states = [...entries.values()].map(e => e.state);
    deps.onNotice(states.includes('blocked') ? 'Commute alerts are blocked. Check your browser notification settings.'
      : states.includes('unsupported') ? 'Commute notifications aren’t supported in this browser.'
      : states.includes('failed') ? 'Some commute alerts couldn’t be sent. Check notifications or keep this tab open.'
      : states.includes('retrying') ? 'A commute alert couldn’t be sent. Retrying shortly.' : null);
  };
  const current = (entry: Entry) => active && entries.get(entry.candidate.key) === entry;
  async function attempt(entry: Entry) {
    if (!current(entry)) return;
    if (deps.now() >= entry.expiresAt) { entry.state = 'failed'; publish(); return; }
    entry.attempts++;
    entry.state = 'pending';
    let outcome: DeliveryOutcome;
    try { outcome = await deps.send(entry.candidate.title, entry.candidate.body,
      { signal: entry.controller.signal, key: entry.candidate.key, expiresAt: entry.expiresAt }); }
    catch { reportNotificationFailure('delivery'); outcome = 'failed'; }
    if (!current(entry)) return;
    if (outcome === 'sent') {
      sent.add(entry.candidate.key);
      entries.delete(entry.candidate.key);
    } else if (outcome === 'failed' && entry.attempts < MAX_ATTEMPTS && deps.now() + RETRY_MS < entry.expiresAt) {
      entry.state = 'retrying';
      entry.cancel = deps.schedule(() => { entry.cancel = undefined; void attempt(entry); }, RETRY_MS);
    } else {
      entry.state = outcome === 'blocked' || outcome === 'unsupported' ? outcome : 'failed';
    }
    publish();
  }
  return {
    observe(keys: readonly string[], candidates: readonly AlertCandidate[], live = true) {
      if (!active) return;
      if (!baseline) { if (live) { keys.forEach(key => ignored.add(key)); baseline = true; } return; }
      const present = new Set(keys), eligible = new Set(candidates.map(c => c.key));
      for (const [key, entry] of entries) {
        if (!present.has(key) || !eligible.has(key)) {
          entry.cancel?.(); entry.controller.abort(); entries.delete(key); ignored.add(key);
        } else if (deps.now() >= entry.expiresAt) {
          entry.cancel?.(); entry.controller.abort(); entry.cancel = undefined; entry.state = 'failed';
        }
      }
      if (live) keys.forEach(key => { if (!eligible.has(key)) ignored.add(key); });
      for (const candidate of live ? candidates : []) {
        if (!present.has(candidate.key) || ignored.has(candidate.key) || sent.has(candidate.key) || entries.has(candidate.key)) continue;
        const entry: Entry = { candidate, attempts: 0, expiresAt: deps.now() + MAX_AGE_MS, state: 'pending', controller: new AbortController() };
        entries.set(candidate.key, entry);
        void attempt(entry);
      }
      publish();
    },
    dispose() {
      active = false;
      entries.forEach(entry => { entry.cancel?.(); entry.controller.abort(); });
      entries.clear();
    },
  };
}
