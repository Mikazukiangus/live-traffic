import { useSyncExternalStore } from 'react';

export interface EndpointHealth {
  path: string; name: string; status: string; method: string; purpose: string; upstream: string;
  latencyMs: number; httpCode: number; error?: string;
}
export interface HealthData {
  status: string; operational: boolean; service: string; version: string; timestamp: string;
  uptimeSeconds: number; environment: string; ltaKeyConfigured: boolean;
  upCount: number; totalCount: number; providerMode: string; endpoints: EndpointHealth[];
}
export interface HealthSnapshot {
  data: HealthData | null; loading: boolean; error: string | null;
  checkedAt: number | null; latencyMs: number | null;
}

export function isHealthData(data: unknown): data is HealthData {
  const d = data as HealthData | null;
  return !!d && typeof d.operational === 'boolean' && typeof d.ltaKeyConfigured === 'boolean'
    && Number.isInteger(d.upCount) && Number.isInteger(d.totalCount) && d.totalCount > 0
    && d.upCount >= 0 && d.upCount <= d.totalCount && typeof d.timestamp === 'string'
    && Number.isFinite(Date.parse(d.timestamp)) && Number.isFinite(d.uptimeSeconds)
    && Array.isArray(d.endpoints) && d.endpoints.length === d.totalCount
    && d.endpoints.filter((e) => e.status === 'UP').length === d.upCount
    && d.operational === (d.upCount === d.totalCount)
    && d.endpoints.every((e) => typeof e.path === 'string' && typeof e.name === 'string'
      && ['UP', 'DOWN'].includes(e.status) && Number.isFinite(e.httpCode) && Number.isFinite(e.latencyMs));
}

let snapshot: HealthSnapshot = { data: null, loading: false, error: null, checkedAt: null, latencyMs: null };
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();
function publish(changes: Partial<HealthSnapshot>) {
  snapshot = { ...snapshot, ...changes };
  listeners.forEach((fn) => fn());
}
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const getHealthSnapshot = () => snapshot;
export function useApiHealth() { return useSyncExternalStore(subscribe, getHealthSnapshot); }

/** The modal and footer always show the same validated, measured check. */
export function refreshApiHealth(): Promise<void> {
  if (pending) return pending;
  publish({ loading: true, error: null });
  pending = (async () => {
    const start = performance.now();
    try {
      const res = await fetch('/api/health', { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: unknown = await res.json();
      if (!isHealthData(data)) throw new Error('Unexpected health response');
      publish({ data, checkedAt: Date.parse(data.timestamp), latencyMs: Math.round(performance.now() - start) });
    } catch (err) {
      publish({ error: err instanceof Error ? err.message : 'Health check failed' });
    } finally {
      publish({ loading: false });
      pending = null;
    }
  })();
  return pending;
}
