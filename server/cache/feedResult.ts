import { createAsyncTtlCache } from '../../shared/ttlCache.ts';
import { NO_STORE, snapshotCacheHeaders } from '../http/responses.ts';
export interface FeedResult { status: number; body: any; headers: Record<string, string> }
export const feedResult = (status: number, body: any, headers = NO_STORE): FeedResult => ({ status, body, headers });
interface Options {
  load: () => Promise<FeedResult>;
  ttlMs: number;
  profile: readonly [number, number];
  complete: (body: any) => boolean;
  validUntil?: (body: any) => number | null;
  now?: () => number;
  maxBytes?: number;
}
/** One keyless normalized result per warm handler; pagination reuses it after request validation. */
export function createFeedResultCache(options: Options) {
  const now = options.now ?? (() => Date.now());
  const cache = createAsyncTtlCache<string, FeedResult>({ now, maxEntries: 1,
    maxWeight: options.maxBytes ?? 512 * 1024, weight: value => Buffer.byteLength(JSON.stringify(value)) });
  const eligible = (value: FeedResult) => value.status === 200 && value.headers['Cache-Control'] !== 'no-store' && options.complete(value.body);
  return {
    async get(): Promise<FeedResult> {
      const entry = await cache.get('result', value => eligible(value)
        ? Math.max(0, Math.min(options.ttlMs, (options.validUntil?.(value.body) ?? (options.validUntil ? now() : Infinity)) - now())) : 0,
      options.load);
      return { ...entry.value, headers: eligible(entry.value)
        ? { ...entry.value.headers, ...snapshotCacheHeaders(entry.expiresAt, options.profile, now()) }
        : { ...entry.value.headers, ...NO_STORE, 'Vercel-CDN-Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store' } };
    },
    // Invalidated pending owners may finish for their original caller but cannot refill the cache.
    invalidate() { cache.clear(); },
  };
}
