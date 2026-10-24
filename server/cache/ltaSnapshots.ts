import { config } from '../../config/server.ts';
import { createAsyncTtlCache } from '../../shared/ttlCache.ts';
import { fetchLtaAll } from '../providers/lta.ts';

import { InvalidPayloadError } from '../../shared/diagnostics.ts';
import { credentialScope } from './scope.ts';
/** Complete validated page envelopes only; raw credentials never become cache keys. */
export function createLtaSnapshots(
  fetchAll: typeof fetchLtaAll = fetchLtaAll,
  now: () => number = () => Date.now(),
) {
  const cache = createAsyncTtlCache<string, any[]>({ now, maxEntries: 8, maxWeight: 4 * 1024 * 1024,
    weight: records => Buffer.byteLength(JSON.stringify(records)) });
  const keyFor = (url: string, accountKey: string, limits?: { wave?: number; maxPages?: number }) =>
    JSON.stringify([url, credentialScope(accountKey), limits?.wave ?? config.server.lta.concurrency, limits?.maxPages ?? config.server.lta.maxPages]);
  return {
    get(url: string, accountKey: string, ttlMs: number, limits?: { wave?: number; maxPages?: number }) {
      return cache.get(keyFor(url, accountKey, limits), ttlMs, async () => {
        const records = await fetchAll(url, accountKey, limits);
        // Each page envelope was validated by fetchAll. Reject unusable records before retention.
        if (!Array.isArray(records) || !records.every(row => row !== null && typeof row === 'object' && !Array.isArray(row)))
          throw new InvalidPayloadError();
        return records;
      });
    },
    invalidate(url: string, accountKey: string, limits?: { wave?: number; maxPages?: number }) { cache.invalidate(keyFor(url, accountKey, limits)); },
    clear: cache.clear,
  };
}
export const ltaSnapshots = createLtaSnapshots();
