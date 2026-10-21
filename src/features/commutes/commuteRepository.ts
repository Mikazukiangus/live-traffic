import {
  commuteRouteKey,
  commutePathKey,
  decodeCommutes,
  decodeHistories,
  HISTORY_KEEP_MS,
  isCommute,
  isCommuteId,
  isSample,
  MAX_COMMUTES,
  type Commute,
  type Sample,
  type RouteHistory,
} from '../../../shared/commutes/model';

export const COMMUTE_STORAGE_KEYS = {
  commutes: 'trafficpulse.commutes.v1',
  history: 'trafficpulse.commuteHistory.v1',
  legacyCommutes: 'trafficpulse.commutes',
  legacyHistory: 'trafficpulse.commuteHistory',
} as const;
export interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface CommuteSnapshot {
  commutes: Commute[];
  notice: string | null;
}
export interface HistoryReceipt {
  id: string;
  routeKey: string;
  minutes: number;
  receivedAt: number;
}

/** Application repository: storage policy, validation, migration and route/history integrity. No React. */
export function createCommuteRepository(
  getStorage: () => StoragePort,
  codes: ReadonlySet<string>,
  now: () => number = Date.now,
) {
  let unavailable = false;
  const failedWrites = new Set<string>();
  const read = (key: string) => {
    try {
      return getStorage().getItem(key);
    } catch {
      unavailable = true;
      return null;
    }
  };
  const current = read(COMMUTE_STORAGE_KEYS.commutes);
  const legacy = current === null;
  const saved = decodeCommutes(legacy ? read(COMMUTE_STORAGE_KEYS.legacyCommutes) : current, codes, legacy);
  const historyRaw = read(COMMUTE_STORAGE_KEYS.history);
  const savedHistory = decodeHistories(historyRaw);
  const legacyHistory = historyRaw === null && read(COMMUTE_STORAGE_KEYS.legacyHistory) !== null;
  let histories = savedHistory.value;
  let snapshot: CommuteSnapshot;
  const listeners = new Set<() => void>();
  const readOnly = unavailable || !saved.writable || !savedHistory.writable;
  const recovery = saved.recovered || savedHistory.recovered;
  const notice = () =>
    unavailable || failedWrites.size
      ? 'Browser storage is unavailable. Changes will last only in this tab.'
      : readOnly
        ? 'Some saved data could not be read. Your stored copy was kept; changes will last only in this tab.'
        : recovery
          ? 'Some saved entries could not be restored. The original saved copy was kept.'
          : legacyHistory
            ? 'Recent travel-time trends will build again after this upgrade.'
            : null;
  snapshot = { commutes: saved.value, notice: notice() };
  const publish = (commutes = snapshot.commutes) => {
    snapshot = { commutes, notice: notice() };
    listeners.forEach((fn) => fn());
  };
  const persist = (key: string, value: unknown) => {
    // Never overwrite unknown versions or partly malformed current stores, even after a user edit.
    if (readOnly) return;
    try {
      getStorage().setItem(key, JSON.stringify(value));
      failedWrites.delete(key);
    } catch {
      failedWrites.add(key);
    }
  };
  const persistHistory = () => persist(COMMUTE_STORAGE_KEYS.history, { schemaVersion: 1, histories });
  const trim = (samples: Sample[], at = now()) =>
    samples.filter(([t]) => t <= at && at - t <= HISTORY_KEEP_MS);
  const hasRoute = (id: string, key: string) =>
    snapshot.commutes.some((c) => c.id === id && commuteRouteKey(c) === key);
  const validReceipt = (row: HistoryReceipt, at: number) =>
    row &&
    hasRoute(row.id, row.routeKey) &&
    isSample([row.receivedAt, row.minutes]) &&
    row.receivedAt <= at &&
    at - row.receivedAt <= HISTORY_KEEP_MS;
  const sameHistories = (a: RouteHistory[], b: RouteHistory[]) =>
    a.length === b.length &&
    a.every((h, i) => {
      const other = b[i];
      return (
        h.commuteId === other.commuteId &&
        h.routeKey === other.routeKey &&
        h.samples.length === other.samples.length &&
        h.samples.every(
          ([time, minutes], j) => time === other.samples[j][0] && minutes === other.samples[j][1],
        )
      );
    });
  const recordBatch = (rows: readonly HistoryReceipt[]) => {
    const at = now();
    const next = histories
      .filter((h) => hasRoute(h.commuteId, h.routeKey))
      .map((h) => ({ ...h, samples: trim(h.samples, at) }))
      .filter((h) => h.samples.length);
    for (const row of rows) {
      if (!validReceipt(row, at)) continue;
      let history = next.find((h) => h.commuteId === row.id);
      if (!history) {
        history = { commuteId: row.id, routeKey: row.routeKey, samples: [] };
        next.push(history);
      }
      const last = history.samples.at(-1);
      // Ignore duplicate/out-of-order receipts. A changed value still needs a full minute.
      if (
        !last ||
        row.receivedAt - last[0] >= 4 * 60_000 ||
        (last[1] !== row.minutes && row.receivedAt - last[0] >= 60_000)
      )
        history.samples.push([row.receivedAt, row.minutes]);
    }
    const changed = !sameHistories(histories, next);
    if (!changed && !failedWrites.has(COMMUTE_STORAGE_KEYS.history)) return;
    histories = next;
    persistHistory();
    // A successful retry can change a failure notice even when samples are unchanged.
    if (changed || snapshot.notice !== notice()) publish();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    save(value: unknown): boolean {
      if (!isCommute(value, codes)) return false;
      const previous = snapshot.commutes.find((c) => c.id === value.id);
      if (!previous && snapshot.commutes.length >= MAX_COMMUTES) return false;
      const commute: Commute = {
        id: value.id,
        name: value.name.trim(),
        alerts: value.alerts,
        routeRevision: previous?.routeRevision ?? 0,
        legs: value.legs.map((l) => ({
          code: l.code,
          direction: l.direction,
          from: l.from.trim(),
          to: l.to.trim(),
        })),
      };
      const changed = previous && commutePathKey(previous) !== commutePathKey(commute);
      if (changed) {
        if (commute.routeRevision! >= Number.MAX_SAFE_INTEGER - 1) return false;
        commute.routeRevision! += 1;
      }
      if (changed) histories = histories.filter((h) => h.commuteId !== commute.id);
      const commutes = previous
        ? snapshot.commutes.map((c) => (c.id === commute.id ? commute : c))
        : [...snapshot.commutes, commute];
      persist(COMMUTE_STORAGE_KEYS.commutes, { schemaVersion: 1, commutes });
      if (changed) persistHistory();
      publish(commutes);
      return true;
    },
    remove(id: string) {
      if (!isCommuteId(id)) return;
      const commutes = snapshot.commutes.filter((c) => c.id !== id);
      histories = histories.filter((h) => h.commuteId !== id);
      persist(COMMUTE_STORAGE_KEYS.commutes, { schemaVersion: 1, commutes });
      persistHistory();
      publish(commutes);
    },
    samples(id: string, routeKey: string): Sample[] {
      if (!hasRoute(id, routeKey)) return [];
      return trim(histories.find((h) => h.commuteId === id && h.routeKey === routeKey)?.samples ?? []).map(
        (s) => [...s],
      );
    },
    recordBatch,
    record(id: string, routeKey: string, minutes: number, receivedAt = now()): Sample[] {
      const row = { id, routeKey, minutes, receivedAt };
      if (!validReceipt(row, now())) return [];
      recordBatch([row]);
      return (histories.find((h) => h.commuteId === id && h.routeKey === routeKey)?.samples ?? []).map(
        (s) => [...s],
      );
    },
    forget(id: string) {
      histories = histories.filter((h) => h.commuteId !== id);
      persistHistory();
      publish();
    },
  };
}
