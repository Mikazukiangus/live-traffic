import { decodeCommutes, decodeHistories, type Commute } from '../../../shared/commutes/model';
import { logger } from '../../../shared/logging';
import { COMMUTE_STORAGE_KEYS as K, createCommuteRepository, type CommuteSnapshot, type StoragePort, type HistoryReceipt } from './commuteRepository';

// New namespace isolates this protocol from old tabs still writing the separate v1 keys.
export const COMMUTE_STATE_KEY = 'trafficpulse.commuteState.v2';
export const COMMUTE_LOCK_NAME = 'trafficpulse.commuteState.v2';
export interface CommuteCoordinatorPorts {
  storage: () => StoragePort;
  exclusive?: <T>(work: () => T) => Promise<T>;
  onChange: (refresh: () => void) => () => void;
  now: () => number;
}
type Repository = ReturnType<typeof createCommuteRepository>;
const LOCAL_NOTICE = 'Shared browser storage is unavailable. Changes will last only in this tab.';
const READ_NOTICE = 'Some saved data could not be read. Your stored copy was kept; changes will last only in this tab.';
const encode = (repo: Repository, revision: number) => {
  const state = repo.exportState();
  return JSON.stringify({ schemaVersion: 2, revision,
    commutes: { schemaVersion: 1, commutes: state.commutes },
    history: { schemaVersion: 1, histories: state.histories } });
};

/** Cross-tab adapter. Every shared mutation rereads and commits one envelope inside Web Locks. */
export function createCoordinatedCommutes(ports: CommuteCoordinatorPorts, codes: ReadonlySet<string>) {
  let localOnly: string | null = ports.exclusive ? null : LOCAL_NOTICE;
  const listeners = new Set<() => void>();
  let stopChanges: (() => void) | undefined;
  const memory = (values = new Map<string, string>()) => createCommuteRepository(() => ({
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  }), codes, ports.now);
  const read = () => {
    const storage = ports.storage();
    const raw = storage.getItem(COMMUTE_STATE_KEY);
    const values = new Map<string, string>();
    let revision = 0;
    let writable = true;
    if (raw !== null) {
      let parsed: any;
      try { parsed = JSON.parse(raw); } catch { /* Invalid copy is preserved. */ }
      if (!parsed || parsed.schemaVersion !== 2 || !Number.isSafeInteger(parsed.revision) || parsed.revision < 0 || !parsed.commutes || !parsed.history) {
        writable = false;
        values.set(K.commutes, '{}');
        values.set(K.history, '{}');
      } else {
        revision = parsed.revision;
        values.set(K.commutes, JSON.stringify(parsed.commutes));
        values.set(K.history, JSON.stringify(parsed.history));
        writable = revision < Number.MAX_SAFE_INTEGER && decodeCommutes(values.get(K.commutes)!, codes).writable && decodeHistories(values.get(K.history)!).writable;
      }
    } else {
      // Read-only migration: never delete or rewrite the user's original v1/legacy copies.
      for (const key of Object.values(K)) {
        const value = storage.getItem(key);
        if (value !== null) values.set(key, value);
      }
      const current = values.get(K.commutes) ?? null;
      writable = decodeCommutes(current ?? values.get(K.legacyCommutes) ?? null, codes, current === null).writable
        && decodeHistories(values.get(K.history) ?? null).writable;
    }
    return { repo: memory(values), writable, revision, raw };
  };
  let loaded: ReturnType<typeof read>;
  try { loaded = read(); } catch { localOnly = LOCAL_NOTICE; loaded = { repo: memory(), writable: false, revision: 0, raw: null }; }
  let repo = loaded.repo;
  if (!loaded.writable && localOnly === null) localOnly = READ_NOTICE;
  let snapshot: CommuteSnapshot = { ...repo.getSnapshot(), notice: localOnly ?? repo.getSnapshot().notice };
  let stateKey = JSON.stringify(repo.exportState());
  const publish = (next: Repository) => {
    repo = next;
    const current = next.getSnapshot();
    const nextKey = JSON.stringify(next.exportState());
    const notice = localOnly ?? current.notice;
    if (nextKey === stateKey && notice === snapshot.notice) return;
    // History changes notify history consumers without restarting commute receipt effects.
    const commutes = JSON.stringify(current.commutes) === JSON.stringify(snapshot.commutes) ? snapshot.commutes : current.commutes;
    stateKey = nextKey;
    snapshot = { commutes, notice };
    listeners.forEach(fn => fn());
  };
  const refresh = () => {
    if (localOnly) return;
    try {
      const latest = read();
      if (!latest.writable) localOnly = READ_NOTICE;
      publish(latest.repo);
    } catch { localOnly = LOCAL_NOTICE; publish(repo); }
  };
  // Also serialize commands in a tab when lock/storage support fails and it becomes local-only.
  let tail: Promise<unknown> = Promise.resolve();
  function update<T>(apply: (current: Repository) => T): Promise<T> {
    const run = async () => {
      if (localOnly) { const result = apply(repo); publish(repo); return result; }
      let applied = false;
      let applyFailed = false;
      let result!: T;
      let candidate = repo;
      try {
        return await ports.exclusive!(() => {
          const latest = read();
          candidate = latest.repo;
          if (!latest.writable) localOnly = READ_NOTICE;
          const before = JSON.stringify(candidate.exportState());
          try { result = apply(candidate); } catch (error) { applyFailed = true; throw error; }
          applied = true;
          // One setItem makes commute changes + history invalidation a single visible commit.
          if (!localOnly && before !== JSON.stringify(candidate.exportState()))
            ports.storage().setItem(COMMUTE_STATE_KEY, encode(candidate, latest.revision + 1));
          publish(candidate);
          return result;
        });
      } catch {
        localOnly = LOCAL_NOTICE;
        if (applyFailed) {
          publish(candidate);
          logger.warn({ event: 'commute_update_failure', code: 'COMMUTE_UPDATE_FAILED', scope: 'app' });
          throw new Error('Commute update failed');
        }
        // A failed commit retains the result in this tab, never replays it over another tab later.
        if (!applied) result = apply(candidate);
        publish(candidate);
        return result;
      }
    };
    const operation = tail.then(run);
    tail = operation.catch(() => undefined);
    return operation;
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(fn: () => void) {
      listeners.add(fn);
      if (listeners.size === 1) { stopChanges = ports.onChange(refresh); refresh(); }
      return () => { listeners.delete(fn); if (!listeners.size) { stopChanges?.(); stopChanges = undefined; } };
    },
    // Capture user/receipt inputs before lock admission; later mutation cannot alter queued work.
    save(value: Commute) { const copy = structuredClone(value); return update(current => current.save(copy)); },
    saveDetails(id: string, name: string, legs: Commute['legs'], create = false) {
      const copy = structuredClone(legs);
      return update(current => current.saveDetails(id, name, copy, create));
    },
    setAlerts: (id: string, enabled: boolean) => update(current => current.setAlerts(id, enabled)),
    remove: (id: string) => update(current => current.remove(id)),
    samples: (id: string, routeKey: string) => repo.samples(id, routeKey),
    recordBatch(rows: readonly HistoryReceipt[]) { const copy = structuredClone(rows); return update(current => current.recordBatch(copy)); },
    record: (id: string, key: string, minutes: number, at = ports.now()) => update(current => current.record(id, key, minutes, at)),
    forget: (id: string) => update(current => current.forget(id)),
  };
}
