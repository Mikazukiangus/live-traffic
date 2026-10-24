import { createTtlStore } from '../../../shared/ttlCache';
interface Ports {
  count: (url: string, signal: AbortSignal) => Promise<number>;
  now: () => number;
  ttlMs: number;
  maxEntries: number;
  version: string;
}
/** Exact URL + inference contract only. No photo bytes, persistence, network or diagnostic keys. */
export function createVehicleCounter(ports: Ports) {
  const cache = createTtlStore<string, number>({ now: ports.now, maxEntries: ports.maxEntries });
  let generation = 0;
  const key = (url: string) => JSON.stringify([ports.version, url]);
  const read = (url: string) => cache.get(key(url))?.value;
  return {
    read,
    async count(url: string, signal: AbortSignal): Promise<number> {
      signal.throwIfAborted();
      const cached = read(url);
      if (cached !== undefined) return cached;
      const owner = generation;
      const count = await ports.count(url, signal);
      signal.throwIfAborted();
      if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid vehicle count');
      if (generation === owner) cache.set(key(url), count, ports.ttlMs);
      return count;
    },
    // Detach pending writers too. New photos automatically miss without mutating other consumers.
    clear() { generation++; cache.clear(); },
  };
}
