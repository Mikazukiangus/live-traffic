import { config } from '../../config/server.ts';
import { fetchPage } from '../providers/ltaSpeedPages.ts';
import { createSpeedAccumulator } from './aggregateSpeeds.ts';
import type { SpeedPayload, SpeedSegment } from '../../shared/traffic/types.ts';
import { createAsyncTtlCache } from '../../shared/ttlCache.ts';
import { credentialScope } from '../cache/scope.ts';
interface Summary { payload: SpeedPayload; segments: SpeedSegment[] }
async function buildSummary(accountKey: string) {
  const accumulator = createSpeedAccumulator();
  const { concurrency, maxPages } = config.server.speeds;
  let pagesFetched = 0,
    totalLinks = 0;
  let lastUpdatedTime: string | undefined;
  let done = false;
  for (let wave = 0; !done && wave * concurrency < maxPages; wave++) {
    const skips = Array.from(
      { length: Math.min(concurrency, maxPages - wave * concurrency) },
      (_, i) => (wave * concurrency + i) * 500,
    );
    const pages = await Promise.all(skips.map((skip) => fetchPage(skip, accountKey)));
    for (const page of pages) {
      pagesFetched++;
      totalLinks += page.value.length;
      lastUpdatedTime ??= page.lastUpdatedTime;
      if (page.value.length < 500) done = true;
      accumulator.add(page.value);
    }
  }
  if (!done) throw new Error('Speed dataset exceeds configured SPEED_MAX_PAGES; refusing a partial result');
  return accumulator.finish(pagesFetched, totalLinks, lastUpdatedTime);
}
/** A complete summary costs hundreds of page reads; account scopes never share results. */
export function createSpeedService(load: (accountKey: string) => Promise<Summary> = buildSummary, now: () => number = () => Date.now(),
  ttlMs = config.server.speeds.cacheTtlMs) {
  const cache = createAsyncTtlCache<string, Summary>({ now, maxEntries: 2, maxWeight: 4 * 1024 * 1024,
    weight: result => Buffer.byteLength(JSON.stringify(result)) });
  return {
    async get(accountKey: string) {
      const entry = await cache.get(credentialScope(accountKey), ttlMs, () => load(accountKey));
      return { ...entry.value, expiresAt: entry.expiresAt };
    },
    invalidate(accountKey: string) { cache.invalidate(credentialScope(accountKey)); },
    clear: cache.clear,
  };
}
const speedService = createSpeedService();
export const getSpeedSummary = speedService.get;
export const invalidateSpeedSummary = speedService.invalidate;
