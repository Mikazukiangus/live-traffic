/** Bounded, lazy-expiring LRU store. Reads never renew the original deadline. */
export interface CacheEntry<T> { value: T; storedAt: number; expiresAt: number }
interface Options<T> {
  now: () => number;
  maxEntries: number;
  maxWeight?: number;
  weight?: (value: T) => number;
}
export function createTtlStore<K, T>(options: Options<T>) {
  if (!Number.isSafeInteger(options.maxEntries) || options.maxEntries < 1) throw new Error('Invalid cache capacity');
  const entries = new Map<K, CacheEntry<T> & { weight: number }>();
  let weight = 0;
  const remove = (key: K) => {
    const entry = entries.get(key);
    if (entry) { weight -= entry.weight; entries.delete(key); }
  };
  const prune = () => {
    for (const [key, entry] of entries) if (options.now() >= entry.expiresAt) remove(key);
  };
  return {
    get(key: K): CacheEntry<T> | undefined {
      prune();
      const entry = entries.get(key);
      if (entry) { entries.delete(key); entries.set(key, entry); }
      return entry;
    },
    set(key: K, value: T, ttlMs: number): CacheEntry<T> {
      const storedAt = options.now();
      const entry = { value, storedAt, expiresAt: storedAt + ttlMs };
      prune(); remove(key);
      const size = options.weight?.(value) ?? 1;
      if (!(ttlMs > 0) || !Number.isFinite(ttlMs) || !(size >= 0) || !Number.isFinite(size) || size > (options.maxWeight ?? Infinity)) return entry;
      entries.set(key, { ...entry, weight: size }); weight += size;
      while (entries.size > options.maxEntries || weight > (options.maxWeight ?? Infinity)) remove(entries.keys().next().value!);
      return entry;
    },
    delete: remove,
    clear() { entries.clear(); weight = 0; },
  };
}

/** Only completed successes are stored. Invalidating also detaches old in-flight owners. */
export function createAsyncTtlCache<K, T>(options: Options<T>) {
  const store = createTtlStore<K, T>(options);
  const pending = new Map<K, Promise<CacheEntry<T>>>();
  return {
    get(key: K, ttlMs: number | ((value: T) => number), load: () => Promise<T>): Promise<CacheEntry<T>> {
      const cached = store.get(key);
      if (cached) return Promise.resolve(cached);
      const existing = pending.get(key);
      if (existing) return existing;
      // Reserve before calling user/provider code; excess distinct work bypasses retention.
      const retain = pending.size < options.maxEntries;
      const request = Promise.resolve().then(load).then(value => {
        const lifetime = typeof ttlMs === 'number' ? ttlMs : ttlMs(value);
        if (retain && pending.get(key) === request) return store.set(key, value, lifetime);
        const storedAt = options.now();
        return { value, storedAt, expiresAt: storedAt + lifetime };
      }).finally(() => { if (pending.get(key) === request) pending.delete(key); });
      if (retain) pending.set(key, request);
      return request;
    },
    invalidate(key: K) { store.delete(key); pending.delete(key); },
    clear() { store.clear(); pending.clear(); },
  };
}
