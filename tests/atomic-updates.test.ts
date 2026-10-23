import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { refreshApiHealth, getHealthSnapshot } from '../src/utils/apiHealth.ts';
import { createSingleFlight } from '../shared/singleFlight.ts';
import { createPolledResource } from '../src/features/feeds/polledResource.ts';
import { createRainResource } from '../src/features/weather/rainResource.ts';
import { createSpeedResource } from '../src/features/traffic/speedResource.ts';
import { createNearMeResource } from '../src/utils/nearMeResource.ts';
import { createInstallPromptResource } from '../src/utils/installPromptResource.ts';
import { createCommuteRepository } from '../src/features/commutes/commuteRepository.ts';
import { serviceWorkerSource, workerGlobals } from './helpers/serviceWorker.ts';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('single flight reserves before synchronous re-entry and releases after success or failure', async () => {
  let calls = 0, settled = 0;
  const flight = createSingleFlight<number>(() => { settled++; });
  const answer = deferred<number>();
  let nested: Promise<number> | undefined;
  const first = flight.run(() => {
    calls++;
    nested = flight.run(() => { calls++; return 99; });
    return answer.promise;
  });
  assert.equal(nested, first);
  assert.equal(flight.run(() => 100), first);
  answer.resolve(7);
  assert.equal(await first, 7);
  assert.equal(calls, 1);
  assert.equal(settled, 1);
  await assert.rejects(flight.run(() => { throw new Error('synthetic'); }), /synthetic/);
  assert.equal(await flight.run(() => 8), 8);
  assert.equal(settled, 3);
});

test('feed observers cannot re-enter admission or final publication to start duplicate work', async () => {
  const rain = {
    success: true, source: 'nea_two_hr_forecast', issuedAt: '2026-10-23T09:00:00+08:00',
    updatedAt: '2026-10-23T09:00:00+08:00', validPeriod: { start: '2026-10-23T09:00:00+08:00', end: '2026-10-23T11:00:00+08:00', text: '9 am to 11 am' },
    areas: [{ name: 'Woodlands', lat: 1.44, lon: 103.77, forecast: 'Showers' }],
  };
  const speed = {
    success: true, source: 'fixture', lastUpdatedTime: '2026-10-23T09:00:00+08:00', generatedAt: '2026-10-23T01:00:00Z',
    pagesFetched: 1, totalLinks: 1, checkpoints: [], expressways: [{ code: 'BKE', avgSpeedKmH: 80, linkCount: 1, slowLinkPct: 0, status: 'Smooth', bandCounts: { 8: 1 } }],
  };
  for (const kind of ['poll', 'rain', 'speed']) {
    const answer = deferred<any>();
    let calls = 0;
    const timers = new Set<() => void>();
    const deps = {
      fetch: () => { calls++; return answer.promise; }, now: () => 1000, pollMs: 100, retryMs: 10,
      schedule: (fn: () => void) => { timers.add(fn); return () => { timers.delete(fn); }; },
      onRefresh: () => () => {}, load: () => null, save: () => {},
    };
    const resource = kind === 'poll' ? createPolledResource({ url: '/api/fixture', pollMs: 100, isValid: (d): d is object => !!d }, deps)
      : kind === 'rain' ? createRainResource(deps) : createSpeedResource(deps);
    const joined: Promise<void>[] = [];
    const stop = resource.connect(() => { joined.push(resource.refresh()); }, 'summary');
    const first = resource.refresh();
    await tick();
    assert.equal(calls, 1, kind);
    answer.resolve({ data: kind === 'rain' ? rain : speed, offline: false, receivedAt: 1000 });
    await first;
    await Promise.all(joined);
    assert.ok(joined.length >= 3, 'includes start, data and final refreshing=false publications');
    assert.ok(joined.every(p => p === first), kind);
    assert.equal(calls, 1, kind);
    assert.equal(timers.size, 1, kind);
    assert.equal(resource.getSnapshot().status, 'live', kind);
    stop();
    assert.equal(timers.size, 0);
  }
});

test('health check admission reserves ownership before invoking the transport', async (t) => {
  let calls = 0;
  let nested: Promise<void> | undefined;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    nested = refreshApiHealth();
    return Response.json({ operational: true, ltaKeyConfigured: true, upCount: 1, totalCount: 1,
      timestamp: '2026-10-23T01:00:00Z', uptimeSeconds: 1,
      endpoints: [{ path: '/api/fixture', name: 'Fixture', status: 'UP', httpCode: 200, latencyMs: 1 }] });
  });
  const first = refreshApiHealth();
  await first;
  assert.equal(nested, first);
  assert.equal(calls, 1);
  assert.equal(getHealthSnapshot().loading, false);
  assert.equal(getHealthSnapshot().error, null);
});

test('replaced URL owners cannot receive old completions and partial results retain their receipt', async () => {
  const a = deferred<any>(), b = deferred<any>();
  const deps = { fetch: (url: string) => url.endsWith('a') ? a.promise : b.promise, now: () => 1000,
    retryMs: 10, schedule: () => () => {}, onRefresh: () => () => {} };
  const make = (url: string) => createPolledResource<{ complete: boolean }>({ url, pollMs: 100, isValid: (d): d is { complete: boolean } => typeof (d as any)?.complete === 'boolean', isComplete: d => d.complete }, deps);
  const old = make('/a'), current = make('/b');
  const first = old.refresh(), second = current.refresh();
  b.resolve({ data: { complete: false }, offline: false, receivedAt: 20 });
  await second;
  const snapshot = current.getSnapshot();
  a.resolve({ data: { complete: true }, offline: false, receivedAt: 10 });
  await first;
  assert.equal(current.getSnapshot(), snapshot);
  assert.equal(snapshot.status, 'error');
  assert.equal(snapshot.fetchedAt, 20);
  assert.deepEqual(snapshot.data, { complete: false });
});

test('newer location denial/fix wins even when old callbacks and automatic permission finish late', async () => {
  const callbacks: { success: PositionCallback; failure: PositionErrorCallback }[] = [];
  const permission = deferred<boolean>();
  const preferences: boolean[] = [];
  const resource = createNearMeResource({
    locate: (success, failure) => { callbacks.push({ success, failure }); },
    optedIn: () => true, remember: value => { preferences.push(value); }, permission: () => permission.promise, now: () => 30,
  });
  const resume = resource.resume();
  resource.locate();
  resource.locate();
  callbacks[1].failure({ code: 1 } as GeolocationPositionError);
  callbacks[0].success({ coords: { latitude: 1, longitude: 2 } } as GeolocationPosition);
  permission.resolve(true);
  await resume;
  assert.equal(callbacks.length, 2, 'late auto-resume must not supersede an explicit tap');
  assert.deepEqual(resource.getSnapshot(), { status: 'denied' });
  assert.deepEqual(preferences, [false]);
  resource.locate(); resource.locate();
  callbacks[3].success({ coords: { latitude: 3, longitude: 4 } } as GeolocationPosition);
  callbacks[2].failure({ code: 1 } as GeolocationPositionError);
  assert.deepEqual(resource.getSnapshot(), { status: 'found', lat: 3, lon: 4, at: 30 });
  assert.deepEqual(preferences, [false, true]);
});

test('install admission is single flight and old completion cannot consume a newer browser event', async (t) => {
  const resource = createInstallPromptResource();
  const prompt = deferred<void>(); let calls = 0;
  resource.offer({ prompt: () => { calls++; return prompt.promise; }, userChoice: Promise.resolve({ outcome: 'dismissed' }) });
  let reentry: Promise<void> | undefined;
  const stop = resource.subscribe(() => { if (!resource.available()) reentry = resource.install(); });
  const first = resource.install();
  assert.equal(reentry, first);
  assert.equal(resource.install(), first);
  resource.offer({ prompt: async () => { calls++; }, userChoice: Promise.resolve({ outcome: 'accepted' }) });
  prompt.resolve(); await first;
  assert.equal(calls, 1);
  assert.equal(resource.available(), true);
  stop();
  await resource.install();
  assert.equal(calls, 2);
  const logs: string[] = [];
  t.mock.method(console, 'warn', (message: string) => { logs.push(message); });
  resource.offer({ prompt: async () => { throw new Error('synthetic-secret'); }, userChoice: Promise.resolve({ outcome: 'dismissed' }) });
  await resource.install();
  assert.equal(logs.length, 1);
  assert.ok(!logs[0].includes('synthetic-secret'));
});

test('permission completion patches only the current alert field and never resurrects a deleted commute', async () => {
  const data = new Map<string, string>();
  const repo = createCommuteRepository(() => ({ getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } }), new Set(['PIE', 'KPE']));
  const commute = { id: 'home', name: 'Home', alerts: false, legs: [{ code: 'PIE', direction: 1, from: 'A', to: 'B' }] };
  repo.save(commute);
  const permission = deferred<boolean>();
  const pending = permission.promise.then(enabled => repo.setAlerts(commute.id, enabled));
  repo.save({ ...commute, name: 'Edited', legs: [{ code: 'KPE', direction: 0, from: '', to: '' }] });
  permission.resolve(true);
  assert.equal(await pending, true);
  assert.equal(repo.getSnapshot().commutes[0].name, 'Edited');
  assert.equal(repo.getSnapshot().commutes[0].legs[0].code, 'KPE');
  assert.equal(repo.getSnapshot().commutes[0].routeRevision, 1);
  assert.equal(repo.getSnapshot().commutes[0].alerts, true);
  assert.equal(repo.saveDetails('home', 'Saved after permission', commute.legs), true);
  assert.equal(repo.getSnapshot().commutes[0].alerts, true, 'a late editor save preserves the current alert flag');
  repo.remove('home');
  assert.equal(repo.setAlerts('home', true), false);
  assert.equal(repo.saveDetails('home', 'Stale editor', commute.legs), false);
  assert.equal(repo.saveDetails('home', 'New commute', commute.legs, true), true);
  assert.equal(repo.saveDetails('home', 'Collision', commute.legs, true), false);
  repo.remove('home');
  assert.deepEqual(repo.getSnapshot().commutes, []);
});

async function workerHarness() {
  const stored = new Map<string, Response>();
  const replies = new Map<string, ReturnType<typeof deferred<Response>>[]>();
  let gate: Promise<void> | undefined;
  let fail = '';
  const puts: string[] = [];
  const key = (request: Request | string) => new URL(typeof request === 'string' ? request : request.url, 'https://fixture.test').href;
  const cache = {
    put: async (request: Request | string, response: Response) => {
      const text = await response.clone().text();
      puts.push(text);
      if (text === fail) throw new Error('synthetic storage failure');
      if (gate && text === 'older') await gate;
      stored.set(key(request), response.clone());
    },
    keys: async () => [], delete: async () => true,
  };
  const context: any = { ...workerGlobals(), self: { location: { origin: 'https://fixture.test' }, addEventListener: () => {} },
    caches: { open: async () => cache, match: async (request: Request | string) => stored.get(key(request))?.clone() },
    fetch: (request: Request) => {
      const next = replies.get(request.url)?.shift();
      if (!next) throw new Error('synthetic offline');
      return next.promise;
    },
  };
  runInNewContext(await serviceWorkerSource(), context);
  return {
    stored, puts,
    reply: (path = '/api/fixture') => {
      const url = 'https://fixture.test' + path;
      const answer = deferred<Response>();
      replies.set(url, [...(replies.get(url) ?? []), answer]);
      return answer;
    },
    request: (path = '/api/fixture', shell = false) => context.networkFirst(new Request('https://fixture.test' + path), shell ? 'shell-v7' : 'data-v5', shell ? '/' : undefined) as Promise<Response>,
    blockOldWrite: (promise: Promise<void>) => { gate = promise; },
    failWrite: (body: string) => { fail = body; },
    cachedRequest: () => context.cacheFirst(new Request('https://fixture.test/assets/fixture.js'), 'assets-v5') as Promise<Response>,
    retained: () => runInNewContext('cacheUpdates.size', context),
  };
}

test('worker rejects late older cache replacements across clients and preserves fallback age', async () => {
  for (const shell of [false, true]) {
    const h = await workerHarness();
    const older = h.reply('/api/one'), newer = h.reply(shell ? '/api/two' : '/api/one');
    const first = h.request('/api/one', shell), second = h.request(shell ? '/api/two' : '/api/one', shell);
    newer.resolve(new Response('newer'));
    assert.equal(await (await second).text(), 'newer');
    const key = 'https://fixture.test' + (shell ? '/' : '/api/one');
    const receipt = h.stored.get(key)!.headers.get('X-TrafficPulse-Cached-At');
    older.resolve(new Response('older'));
    assert.equal(await (await first).text(), 'older', 'each caller still receives its own network answer');
    assert.equal(await h.stored.get(key)!.clone().text(), 'newer');
    const fallback = await h.request('/api/one', shell);
    assert.equal(await fallback.text(), 'newer');
    assert.equal(fallback.headers.get('X-TrafficPulse-Cached-At'), receipt);
    if (!shell) assert.equal(fallback.headers.get('X-TrafficPulse-Offline'), '1');
    assert.equal(h.retained(), 0, 'idle URL locks are released');
  }
});

test('worker serializes writes for one key while unrelated keys proceed independently', async () => {
  const h = await workerHarness(), gate = deferred<void>();
  h.blockOldWrite(gate.promise);
  const old = h.reply(), next = h.reply(), other = h.reply('/api/other');
  const first = h.request(), second = h.request(), third = h.request('/api/other');
  old.resolve(new Response('older'));
  while (!h.puts.includes('older')) await tick();
  next.resolve(new Response('newer')); other.resolve(new Response('unrelated'));
  assert.equal(await (await third).text(), 'unrelated');
  await tick();
  assert.ok(!h.puts.includes('newer'), 'comparison and put are one serialized operation');
  gate.resolve(); await Promise.all([first, second]);
  assert.equal(await h.stored.get('https://fixture.test/api/fixture')!.text(), 'newer');
  assert.equal(h.retained(), 0);
});

test('failed newer storage or HTTP answers do not suppress an older successful cache write', async () => {
  for (const storageFailure of [false, true]) {
    const h = await workerHarness();
    if (storageFailure) h.failWrite('newer');
    const old = h.reply(), next = h.reply();
    const first = h.request(), second = h.request();
    next.resolve(new Response('newer', { status: storageFailure ? 200 : 502 }));
    await second;
    old.resolve(new Response('older')); await first;
    assert.equal(await h.stored.get('https://fixture.test/api/fixture')!.text(), 'older');
    assert.equal(h.retained(), 0);
  }
});


test('cache-first misses also retain the newer response when network requests finish in reverse order', async () => {
  const h = await workerHarness();
  const old = h.reply('/assets/fixture.js'), next = h.reply('/assets/fixture.js');
  const first = h.cachedRequest(), second = h.cachedRequest();
  await tick();
  next.resolve(new Response('newer')); await second;
  old.resolve(new Response('older')); await first;
  assert.equal(await h.stored.get('https://fixture.test/assets/fixture.js')!.text(), 'newer');
  assert.equal(h.retained(), 0);
});
