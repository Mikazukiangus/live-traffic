import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTtlStore, createAsyncTtlCache } from '../shared/ttlCache.ts';
import { createLtaSnapshots } from '../server/cache/ltaSnapshots.ts';
import { credentialScope } from '../server/cache/scope.ts';
import { createSpeedService } from '../server/traffic/speedService.ts';
import { snapshotCacheHeaders } from '../server/http/responses.ts';
import { createVehicleCounter } from '../src/features/vehicle-counting/countCache.ts';
import { createVehicleJobs } from '../src/features/vehicle-counting/vehicleJobs.ts';
import { createBackgroundQueue } from '../src/features/background/taskQueue.ts';
import { createConfig, createPublicConfig } from '../config/schema.ts';
import type { SpeedPayload } from '../shared/traffic/types.ts';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
const summary = { payload: { generatedAt: '2026-10-24T01:00:00Z' } as SpeedPayload, segments: [] };

test('TTL reads preserve original receipt/deadline, expire exactly on the boundary and accept zero values', () => {
  let now = 1000;
  const cache = createTtlStore<string, number>({ now: () => now, maxEntries: 2 });
  cache.set('photo', 0, 100); now = 1099;
  assert.equal(cache.get('photo')?.value, 0);
  assert.equal(cache.get('photo')?.storedAt, 1000);
  assert.equal(cache.get('photo')?.expiresAt, 1100);
  now = 1100; assert.equal(cache.get('photo'), undefined);
  cache.set('disabled', 1, 0); assert.equal(cache.get('disabled'), undefined);
});

test('cache bounds use LRU and serialized weight; oversized answers still return without retention', async () => {
  const cache = createTtlStore<string, string>({ now: () => 0, maxEntries: 2, maxWeight: 4, weight: v => v.length });
  cache.set('a', 'aa', 100); cache.set('b', 'bb', 100); cache.get('a'); cache.set('c', 'cc', 100);
  assert.equal(cache.get('b'), undefined); assert.equal(cache.get('a')?.value, 'aa');
  cache.set('large', '12345', 100); assert.equal(cache.get('large'), undefined);
  assert.equal(cache.get('a')?.value, 'aa');
  const asyncCache = createAsyncTtlCache<string, string>({ now: () => 0, maxEntries: 1, maxWeight: 1, weight: v => v.length });
  let calls = 0;
  for (let i = 0; i < 2; i++) assert.equal((await asyncCache.get('large', 100, async () => { calls++; return 'large'; })).value, 'large');
  assert.equal(calls, 2);
});

test('async cache reserves before work, shares cold work and retains only successful completions', async () => {
  let now = 10, calls = 0;
  const cache = createAsyncTtlCache<string, number>({ now: () => now, maxEntries: 2 });
  const answer = deferred<number>();
  const load = () => { calls++; return answer.promise; };
  const a = cache.get('same', 100, load), b = cache.get('same', 100, load);
  assert.equal(a, b); await tick(); assert.equal(calls, 1);
  now = 50; answer.resolve(3);
  assert.equal((await a).storedAt, 50);
  now = 149; assert.equal((await cache.get('same', 100, load)).value, 3); assert.equal(calls, 1);
  now = 150; await cache.get('same', 100, load); assert.equal(calls, 2);
  const fail = () => { calls++; return Promise.reject(new Error('synthetic failure')); };
  await assert.rejects(cache.get('bad', 100, fail)); await assert.rejects(cache.get('bad', 100, fail));
  assert.equal(calls, 4);
});

test('invalidation prevents stale pending writes and old cleanup cannot detach a newer owner', async () => {
  const cache = createAsyncTtlCache<string, number>({ now: () => 0, maxEntries: 2 });
  const old = deferred<number>(), replacement = deferred<number>();
  const first = cache.get('key', 100, () => old.promise);
  cache.invalidate('key');
  const next = cache.get('key', 100, () => replacement.promise);
  old.resolve(1); assert.equal((await first).value, 1);
  assert.equal(cache.get('key', 100, async () => 99), next);
  replacement.resolve(2); await next;
  assert.equal((await cache.get('key', 100, async () => 99)).value, 2);
  cache.clear(); assert.equal((await cache.get('key', 100, async () => 3)).value, 3);
});

test('distinct in-flight cache keys have a bounded retention index and overflow does not evict active owners', async () => {
  const cache = createAsyncTtlCache<string, number>({ now: () => 0, maxEntries: 1 });
  const held = deferred<number>(); const first = cache.get('held', 100, () => held.promise);
  let calls = 0;
  await cache.get('overflow', 100, async () => ++calls);
  await cache.get('overflow', 100, async () => ++calls);
  assert.equal(calls, 2); assert.equal(cache.get('held', 100, async () => 99), first);
  held.resolve(5); await first;
});

test('paginated snapshots coalesce and isolate endpoint, credential and page limits without caching failures', async () => {
  let now = 1000, calls = 0; const received = [{ EventID: 'synthetic' }];
  const snapshots = createLtaSnapshots(async () => { calls++; return received; }, () => now);
  const a = snapshots.get('https://example.test/roadworks', 'key-one', 300000);
  const b = snapshots.get('https://example.test/roadworks', 'key-one', 300000);
  assert.equal(a, b); await a;
  for (let i = 0; i < 20; i++) await snapshots.get('https://example.test/roadworks', 'key-one', 300000);
  assert.equal(calls, 1, '20 repeated full-dataset reads avoid all further provider pages');
  now += 299999; assert.equal((await snapshots.get('https://example.test/roadworks', 'key-one', 300000)).storedAt, 1000);
  await snapshots.get('https://example.test/lights', 'key-one', 60000);
  await snapshots.get('https://example.test/roadworks', 'key-two', 300000);
  await snapshots.get('https://example.test/roadworks', 'key-one', 300000, { wave: 1 });
  assert.equal(calls, 4);
  now++; await snapshots.get('https://example.test/roadworks', 'key-one', 300000); assert.equal(calls, 5);
  snapshots.invalidate('https://example.test/roadworks', 'key-one');
  await snapshots.get('https://example.test/roadworks', 'key-one', 300000); assert.equal(calls, 6);
  snapshots.clear(); await snapshots.get('https://example.test/roadworks', 'key-one', 300000); assert.equal(calls, 7);
  assert.ok(!credentialScope('synthetic-private-key').includes('synthetic'));
});

test('malformed or incomplete paginated snapshots are not retained and a valid empty dataset is retained', async () => {
  let calls = 0;
  const snapshots = createLtaSnapshots(async () => {
    calls++; if (calls <= 2) throw new Error('partial or invalid page'); return [];
  });
  for (let i = 0; i < 2; i++) await assert.rejects(snapshots.get('https://example.test/data', 'key', 100));
  assert.deepEqual((await snapshots.get('https://example.test/data', 'key', 100)).value, []);
  await snapshots.get('https://example.test/data', 'key', 100); assert.equal(calls, 3);
});

test('speed aggregation retains original metadata, scopes accounts, expires and supports invalidation', async () => {
  let now = 0, calls = 0;
  const service = createSpeedService(async () => { calls++; return summary; }, () => now, 300000);
  await Promise.all(Array.from({ length: 20 }, () => service.get('first'))); assert.equal(calls, 1);
  now = 299999; const hit = await service.get('first');
  assert.equal(hit.payload.generatedAt, summary.payload.generatedAt); assert.equal(hit.expiresAt, 300000);
  await service.get('second'); assert.equal(calls, 2);
  now = 300000; await service.get('first'); assert.equal(calls, 3);
  service.invalidate('first'); await service.get('first'); assert.equal(calls, 4);
  service.clear(); await service.get('second'); assert.equal(calls, 5);
});

test('origin hits cannot restart a full CDN fresh/SWR period or override disabled CDN caching', () => {
  assert.equal(snapshotCacheHeaders(300000, [300, 600], 0)['Vercel-CDN-Cache-Control'], 'max-age=300, stale-while-revalidate=0');
  assert.equal(snapshotCacheHeaders(300000, [300, 600], 299000)['Vercel-CDN-Cache-Control'], 'max-age=1, stale-while-revalidate=0');
  assert.equal(snapshotCacheHeaders(300000, [30, 60], 250000)['Vercel-CDN-Cache-Control'], 'max-age=30, stale-while-revalidate=20');
  assert.equal(snapshotCacheHeaders(300000, [300, 600], 300000)['Vercel-CDN-Cache-Control'], 'max-age=0, stale-while-revalidate=0');
  assert.equal(snapshotCacheHeaders(300000, [0, 0], 0)['Vercel-CDN-Cache-Control'], 'max-age=0, stale-while-revalidate=0');
  assert.match(snapshotCacheHeaders(300000, [300, 600], 0)['Cache-Control'], /must-revalidate/);
});

test('same-photo inference reuses zero counts until TTL, misses changed URLs, and is bounded by LRU', async () => {
  let now = 0, calls = 0;
  const counter = createVehicleCounter({ count: async () => { calls++; return 0; }, now: () => now, ttlMs: 300000, maxEntries: 2, version: 'model-v1' });
  const signal = new AbortController().signal;
  for (let i = 0; i < 20; i++) assert.equal(await counter.count('photo-one', signal), 0);
  assert.equal(calls, 1, '19 repeated photos avoid 456 tile inferences at 24 tiles per image');
  now = 299999; assert.equal(counter.read('photo-one'), 0);
  now = 300000; assert.equal(counter.read('photo-one'), undefined); await counter.count('photo-one', signal); assert.equal(calls, 2);
  await counter.count('photo-two', signal); counter.read('photo-one'); await counter.count('photo-three', signal);
  assert.equal(counter.read('photo-two'), undefined); assert.equal(counter.read('photo-one'), 0);
  counter.clear(); assert.equal(counter.read('photo-one'), undefined);
});

test('failed, aborted or invalidated inference never populates results; the model contract scopes the cache', async () => {
  let calls = 0; const answer = deferred<number>();
  const counter = createVehicleCounter({ count: async () => { calls++; return answer.promise; }, now: () => 0, ttlMs: 100, maxEntries: 2, version: 'model-v1' });
  const controller = new AbortController(); const count = counter.count('photo', controller.signal);
  controller.abort(); answer.resolve(5); await assert.rejects(count); assert.equal(counter.read('photo'), undefined);
  const next = counter.count('photo', new AbortController().signal); counter.clear(); await next;
  assert.equal(counter.read('photo'), undefined);
  await counter.count('photo', new AbortController().signal); assert.equal(counter.read('photo'), 5);
  const changed = createVehicleCounter({ count: async () => ++calls, now: () => 0, ttlMs: 100, maxEntries: 2, version: 'model-v2' });
  assert.equal(changed.read('photo'), undefined); await changed.count('photo', new AbortController().signal); assert.equal(calls, 4);
  for (const bad of [NaN, -1, 0.5]) {
    const invalid = createVehicleCounter({ count: async () => bad, now: () => 0, ttlMs: 100, maxEntries: 2, version: 'test' });
    await assert.rejects(invalid.count('photo', new AbortController().signal)); assert.equal(invalid.read('photo'), undefined);
  }
});

test('new camera resource reuses counts without queue admission; expiry and clearing enqueue current-photo work', async () => {
  let now = 0, calls = 0, state: any;
  const turns: (() => void)[] = [];
  const queue = createBackgroundQueue({ now: () => now, maxPending: 32, maxAgeMs: 1000,
    defer: run => { turns.push(run); return () => {}; }, schedule: () => () => {}, failed: () => {} });
  const counter = createVehicleCounter({ count: async () => ++calls, now: () => now, ttlMs: 100, maxEntries: 2, version: 'model-v1' });
  const make = (owner: string) => createVehicleJobs({ queue, owner, count: counter.count, cached: counter.read, retryMs: 10, publish: value => { state = value; } });
  const cameras = [{ id: 'a', imageUrl: 'photo' }], options = { enabled: true, visible: true };
  const flush = async () => { for (let n = 0; n < 5; n++) { turns.splice(0).forEach(run => run()); await tick(); } };
  const first = make('first'); first.update(cameras, options); await flush(); assert.equal(calls, 1); first.dispose();
  const second = make('second'); second.update(cameras, options);
  assert.equal(state.status, 'ready'); assert.equal(queue.stats().waiting, 0); assert.equal(state.counts.a.count, 1);
  now = 100; second.update(cameras, options); await flush(); assert.equal(calls, 2);
  counter.clear(); second.update(cameras, options); await flush(); assert.equal(calls, 3);
  second.dispose();
  let recovered: number | undefined;
  const failed = createVehicleJobs({ queue, owner: 'recovery', count: async () => NaN, cached: () => recovered,
    retryMs: 1000, publish: value => { state = value; } });
  failed.update(cameras, options); await flush(); assert.equal(state.status, 'error');
  recovered = 7; failed.update(cameras, options);
  assert.equal(state.status, 'ready', 'another successful consumer clears the old failure on a cache hit');
  assert.equal(state.counts.a.count, 7); failed.dispose(); queue.dispose();
});

test('cache configuration is validated, can disable new caches and stays within public/server scopes', () => {
  const c = createConfig(); assert.deepEqual(c.server.snapshotCache, { roadWorksMs: 300000, faultyLightsMs: 60000, carParksMs: 60000 });
  assert.deepEqual(c.vehicleCache, { ttlMs: 300000, maxEntries: 32 });
  assert.equal(createPublicConfig({ VITE_VEHICLE_CACHE_TTL_MS: '0' }).vehicleCache.ttlMs, 0);
  assert.equal(createConfig({ CARPARKS_CACHE_TTL_MS: '0' }).server.snapshotCache.carParksMs, 0);
  assert.ok(!('server' in createPublicConfig({ ROADWORKS_CACHE_TTL_MS: 'bad' })));
  for (const [key, value] of [['VITE_VEHICLE_CACHE_MAX_ENTRIES', '0'], ['VITE_VEHICLE_CACHE_TTL_MS', '900001'], ['CARPARKS_CACHE_TTL_MS', '-1']])
    assert.throws(() => createConfig({ [key]: value }), error => error instanceof Error && error.message.includes(key));
});
