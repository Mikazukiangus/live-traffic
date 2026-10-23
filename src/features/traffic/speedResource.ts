import { createSingleFlight } from '../../../shared/singleFlight';
import type { SpeedPayload, SpeedSegment } from '../../../shared/traffic/types';
import type { FeedResponse } from '../../utils/feedResponse';

export type SpeedDemand = 'summary' | 'full' | 'geometry';
export interface SpeedState {
  data: SpeedPayload | null;
  status: 'loading' | 'live' | 'error';
  fetchedAt: number | null;
  fromSnapshot: boolean;
  refreshing: boolean;
  geometry: SpeedSegment[];
}
interface Dependencies {
  fetch: (url: string) => Promise<FeedResponse<unknown>>;
  load: () => { json: unknown } | null;
  save: (data: SpeedPayload) => void;
  now: () => number;
  pollMs: number;
  retryMs: number;
  schedule: (run: () => void, ms: number) => () => void;
  onRefresh: (run: () => void) => () => void;
}
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Validate at the resource boundary, including stored data and map tuples. */
export function isSpeedPayload(value: unknown): value is SpeedPayload {
  const d = value as SpeedPayload | null;
  return (
    !!d &&
    d.success === true &&
    typeof d.source === 'string' &&
    typeof d.generatedAt === 'string' &&
    Number.isFinite(Date.parse(d.generatedAt)) &&
    Number.isInteger(d.pagesFetched) &&
    d.pagesFetched > 0 &&
    Number.isInteger(d.totalLinks) &&
    d.totalLinks >= 0 &&
    (d.lastUpdatedTime === null || typeof d.lastUpdatedTime === 'string') &&
    Array.isArray(d.expressways) &&
    d.expressways.length > 0 &&
    d.expressways.every(
      (e) =>
        e &&
        typeof e.code === 'string' &&
        finite(e.avgSpeedKmH) &&
        e.avgSpeedKmH >= 0 &&
        finite(e.linkCount) &&
        e.linkCount > 0 &&
        finite(e.slowLinkPct) &&
        e.slowLinkPct >= 0 &&
        e.slowLinkPct <= 100 &&
        !!e.bandCounts &&
        typeof e.bandCounts === 'object' &&
        Object.entries(e.bandCounts).every(
          ([band, count]) => /^[1-8]$/.test(band) && Number.isInteger(count) && count >= 0,
        ) &&
        ['Smooth', 'Moderate', 'Heavy', 'Congested'].includes(e.status),
    ) &&
    Array.isArray(d.checkpoints) &&
    d.checkpoints.every(
      (c) =>
        c &&
        ['woodlands', 'tuas'].includes(c.id) &&
        typeof c.name === 'string' &&
        typeof c.via === 'string' &&
        [c.km, c.minutes, c.minMinutes, c.maxMinutes].every((n) => finite(n) && n >= 0) &&
        (c.queueSpeedKmH === null || (finite(c.queueSpeedKmH) && c.queueSpeedKmH >= 0)),
    ) &&
    (d.segments === undefined ||
      (Array.isArray(d.segments) &&
        d.segments.every(
          (s) =>
            Array.isArray(s) &&
            s.length === 6 &&
            typeof s[0] === 'string' &&
            Number.isInteger(s[1]) &&
            s[1] >= 1 &&
            s[1] <= 8 &&
            s.slice(2).every(finite),
        )))
  );
}

/** One resource owns requests, timing and retained state for all speed consumers. */
export function createSpeedResource(deps: Dependencies) {
  let state: SpeedState = {
    data: null,
    status: 'loading',
    fetchedAt: null,
    fromSnapshot: false,
    refreshing: false,
    geometry: [],
  };
  const subscribers = new Map<() => void, SpeedDemand>();
  const flight = createSingleFlight<void>(() => schedule());
  let pendingFull = false;
  let cancelTimer: (() => void) | undefined;
  let removeRefresh: (() => void) | undefined;
  let started = false;
  const publish = (changes: Partial<SpeedState>) => {
    state = { ...state, ...changes };
    subscribers.forEach((_, fn) => fn());
  };
  const needsFull = () =>
    [...subscribers.values()].includes('full') ||
    ([...subscribers.values()].includes('geometry') && !state.geometry.length);
  const polling = () => [...subscribers.values()].some((d) => d !== 'geometry') || needsFull();
  const schedule = () => {
    cancelTimer?.();
    cancelTimer = undefined;
    if (subscribers.size && !flight.current && polling()) {
      cancelTimer = deps.schedule(
        () => {
          void refresh();
        },
        state.status === 'live' ? deps.pollMs : deps.retryMs,
      );
    }
  };
  function refresh(): Promise<void> {
    if (flight.current) {
      // A full consumer arriving during a summary request gets one serialized upgrade.
      const upgrade = needsFull() && !pendingFull;
      return upgrade ? flight.current.then(() => (subscribers.size && needsFull() ? refresh() : undefined)) : flight.current;
    }
    cancelTimer?.();
    cancelTimer = undefined;
    pendingFull = needsFull();
    const full = pendingFull;
    return flight.run(async () => {
      publish({ refreshing: true });
      try {
        const result = await deps.fetch(`/api/expresswayspeeds${full ? '?include=segments' : ''}`);
        if (!isSpeedPayload(result.data) || (full && !Array.isArray(result.data.segments)))
          throw new Error('Unexpected speeds');
        const sameObservation =
          result.data.lastUpdatedTime != null && result.data.lastUpdatedTime === state.data?.lastUpdatedTime;
        const data = {
          ...result.data,
          segments: result.data.segments ?? (sameObservation ? state.data?.segments : undefined),
        };
        publish({
          data,
          status: result.offline ? 'error' : 'live',
          fetchedAt: result.receivedAt,
          fromSnapshot: result.offline,
          geometry: result.data.segments?.length ? result.data.segments : state.geometry,
        });
        // An offline answer retains its original age; never extend its storage lifetime.
        if (!result.offline) deps.save(data);
      } catch {
        const stored = !state.data ? deps.load()?.json : null;
        publish(
          isSpeedPayload(stored)
            ? { data: stored, status: 'error', fromSnapshot: true, geometry: stored.segments ?? state.geometry }
            : { status: 'error' },
        );
      } finally {
        publish({ refreshing: false });
      }
    });
  }
  const connect = (listener: () => void, demand: SpeedDemand) => {
    subscribers.set(listener, demand);
    if (!started) {
      started = true;
      removeRefresh = deps.onRefresh(() => {
        void refresh();
      });
    }
    // Coalesce all subscriptions from the same React commit before choosing payload size.
    queueMicrotask(() => {
      if (!subscribers.has(listener)) return;
      if (
        !state.data ||
        (needsFull() && !state.data.segments) ||
        !state.fetchedAt ||
        deps.now() - state.fetchedAt >= deps.pollMs
      )
        void refresh();
      else schedule();
    });
    return () => {
      subscribers.delete(listener);
      if (!subscribers.size) {
        cancelTimer?.();
        cancelTimer = undefined;
        removeRefresh?.();
        removeRefresh = undefined;
        started = false;
      } else schedule();
    };
  };
  return { connect, refresh, getSnapshot: () => state };
}
