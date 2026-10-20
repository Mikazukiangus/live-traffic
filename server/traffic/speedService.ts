import { config } from '../../config/server.ts';
import { fetchPage } from '../providers/ltaSpeedPages.ts';
import { createSpeedAccumulator } from './aggregateSpeeds.ts';
import type { SpeedPayload, SpeedSegment } from '../../shared/traffic/types.ts';
let cache: { expiresAt: number; payload: SpeedPayload; segments: SpeedSegment[] } | null = null;
let pending: Promise<{ payload: SpeedPayload; segments: SpeedSegment[] }> | null = null;
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
/** Coalesce requests within an instance as well as retaining the completed aggregation. */
export async function getSpeedSummary(accountKey: string) {
  if (cache && Date.now() <= cache.expiresAt) return cache;
  pending ??= buildSummary(accountKey)
    .then((result) => {
      cache = { ...result, expiresAt: Date.now() + config.server.speeds.cacheTtlMs };
      return result;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}
