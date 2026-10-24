import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFeedResultCache, feedResult } from '../server/cache/feedResult.ts';
import { liveCacheHeaders } from '../server/http/responses.ts';
import { createConfig, createPublicConfig } from '../config/schema.ts';
const profile = [300, 600] as const;
const good = (id = 1) => feedResult(200, { id, issuedAt: '2026-10-24T01:00:00Z' }, liveCacheHeaders(...profile));
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }

test('normalized result cache coalesces cold builds, preserves original body and decreases CDN lifetime on hits', async () => {
  let now = 1000, calls = 0;
  const answer = deferred<ReturnType<typeof good>>();
  const cache = createFeedResultCache({ load: () => { calls++; return answer.promise; }, now: () => now, ttlMs: 300000, profile, complete: () => true });
  const requests = Array.from({ length: 20 }, () => cache.get()); await tick(); assert.equal(calls, 1);
  answer.resolve(good()); const first = await Promise.all(requests);
  assert.ok(first.every(r => r.body === first[0].body));
  now += 299000; const hit = await cache.get();
  assert.equal(hit.body.issuedAt, first[0].body.issuedAt); assert.equal(calls, 1);
  assert.equal(hit.headers['Vercel-CDN-Cache-Control'], 'max-age=1, stale-while-revalidate=0');
  now += 1000; await cache.get(); assert.equal(calls, 2);
});

test('result expiry is capped by forecast validity, and missing/expired validity never retains a result', async () => {
  let now = 0, calls = 0, end: number | null = 10000;
  const cache = createFeedResultCache({ load: async () => { calls++; return good(); }, now: () => now, ttlMs: 900000, profile,
    complete: () => true, validUntil: () => end });
  assert.equal((await cache.get()).headers['Vercel-CDN-Cache-Control'], 'max-age=10, stale-while-revalidate=0');
  now = 9999; await cache.get(); assert.equal(calls, 1);
  now = 10000; await cache.get(); await cache.get(); assert.equal(calls, 3);
  end = null; await cache.get(); await cache.get(); assert.equal(calls, 5);
});

test('partial, error, incomplete, oversized and zero-TTL responses do not become reusable successes; retry hints survive', async () => {
  for (const kind of ['partial', 'error', 'incomplete', 'oversize', 'disabled']) {
    let calls = 0;
    const cache = createFeedResultCache({ load: async () => { calls++; return kind === 'error'
      ? feedResult(502, { error: 'fixed' }, { 'Cache-Control': 'no-store', 'Retry-After': '5' })
      : kind === 'partial' ? feedResult(200, { id: 1 }, { 'Cache-Control': 'no-store' }) : good(); },
    ttlMs: kind === 'disabled' ? 0 : 1000, profile, complete: () => kind !== 'incomplete', maxBytes: kind === 'oversize' ? 1 : 10000 });
    const first = await cache.get(); await cache.get(); assert.equal(calls, 2, kind);
    if (['partial', 'error', 'incomplete'].includes(kind)) { assert.equal(first.headers['Cache-Control'], 'no-store'); assert.equal(first.headers['Vercel-CDN-Cache-Control'], 'no-store'); }
    if (kind === 'error') assert.equal(first.headers['Retry-After'], '5');
  }
});

test('failed loads are retried, invalidation detaches pending owners and original completion cannot refill a replacement', async () => {
  let calls = 0; const old = deferred<ReturnType<typeof good>>();
  const cache = createFeedResultCache({ load: () => { calls++; return calls === 1 ? old.promise : Promise.resolve(good(calls)); },
    ttlMs: 1000, profile, complete: () => true });
  const first = cache.get(); await tick(); cache.invalidate();
  assert.equal((await cache.get()).body.id, 2); old.resolve(good(1)); await first;
  assert.equal((await cache.get()).body.id, 2); assert.equal(calls, 2);
  cache.invalidate(); assert.equal((await cache.get()).body.id, 3);
  let fails = 0; const rejected = createFeedResultCache({ load: async () => { fails++; throw new Error('synthetic'); }, ttlMs: 1000, profile, complete: () => true });
  await assert.rejects(rejected.get()); await assert.rejects(rejected.get()); assert.equal(fails, 2);
});

test('weather result TTLs are validated, can be disabled and never enter public config', () => {
  const c = createConfig(); assert.equal(c.server.weather.airCacheTtlMs, 300000); assert.equal(c.server.weather.forecast24hCacheTtlMs, 900000); assert.equal(c.server.weather.alertsCacheTtlMs, 60000);
  assert.equal(createConfig({ AIR_CACHE_TTL_MS: '0' }).server.weather.airCacheTtlMs, 0);
  for (const [key, value] of [['AIR_CACHE_TTL_MS', '-1'], ['FORECAST24H_CACHE_TTL_MS', '3600001'], ['WEATHER_ALERTS_CACHE_TTL_MS', '180001']]) assert.throws(() => createConfig({ [key]: value }));
  assert.ok(!JSON.stringify(createPublicConfig({ AIR_CACHE_TTL_MS: 'invalid-private' })).includes('invalid-private'));
});
