import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBackgroundQueue, type TaskLane } from '../src/features/background/taskQueue.ts';
import { createVehicleJobs } from '../src/features/vehicle-counting/vehicleJobs.ts';
import { createHistoryJobs } from '../src/features/commutes/historyJobs.ts';
import { createNotificationJobs } from '../src/features/commutes/notificationJobs.ts';
import { createCommuteAlertQueue } from '../src/features/commutes/commuteAlertQueue.ts';
import { sendCommuteNotification, type NotificationPort } from '../src/features/commutes/notificationDelivery.ts';
import { loadImage } from '../src/features/vehicle-counting/loadImage.ts';
import { createPublicConfig } from '../config/schema.ts';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness(maxPending = 32, maxAgeMs = 120000) {
  let now = 100000;
  const turns = new Map<() => void, boolean>();
  const timers = new Set<{ run: () => void; at: number }>();
  const failures: { lane: TaskLane; state: string }[] = [];
  const queue = createBackgroundQueue({ now: () => now, maxPending, maxAgeMs,
    defer: (run, urgent) => { turns.set(run, urgent); return () => { turns.delete(run); }; },
    schedule: (run, ms) => { const task = { run, at: now + ms }; timers.add(task); return () => { timers.delete(task); }; },
    failed: (lane, state) => { failures.push({ lane, state }); },
  });
  const flush = async () => {
    for (let n = 0; n < 50; n++) {
      if (!turns.size) { await tick(); if (!turns.size) return; }
      const pending = [...turns.keys()]; turns.clear(); pending.forEach(run => run()); await tick();
    }
    assert.fail('background scheduler did not become idle');
  };
  return { queue, turns, timers, failures, flush, now: () => now,
    advance: (ms: number) => { now += ms; for (const task of [...timers]) if (task.at <= now && timers.delete(task)) task.run(); },
  };
}

test('background work defers off the caller, prioritizes within lanes and never blocks another lane on inference', async () => {
  const h = harness(), blocking = deferred<number>(), starts: string[] = [];
  const enqueue = (key: string, lane: TaskLane, priority = 0) => h.queue.enqueue({ lane, key, priority, run: async () => { starts.push(key); return key === 'visible' ? blocking.promise : 1; } });
  const later = enqueue('later', 'analysis', 10), first = enqueue('visible', 'analysis');
  const history = enqueue('receipt', 'history'); const notification = enqueue('alert', 'notifications');
  assert.deepEqual(starts, []);
  assert.equal([...h.turns.values()][0], true, 'notification promotes an idle turn to prompt scheduling');
  await h.flush();
  assert.deepEqual(starts, ['alert', 'receipt', 'visible']);
  assert.deepEqual(h.queue.stats().running, { analysis: 1, history: 0, notifications: 0 });
  assert.equal((await history.result).state, 'done'); assert.equal((await notification.result).state, 'done');
  blocking.resolve(7); await h.flush();
  assert.deepEqual(await first.result, { state: 'done', value: 7 }); assert.equal((await later.result).state, 'done');
  assert.equal(h.timers.size, 0); h.queue.dispose();
});

test('duplicates share original admission/lifetime and repeated enqueue does not postpone the scheduled idle turn', async () => {
  const h = harness(); let calls = 0;
  const task = { lane: 'history' as const, key: 'receipt', run: () => { calls++; } };
  const first = h.queue.enqueue(task), scheduled = [...h.turns.keys()][0];
  h.advance(1000);
  assert.equal(h.queue.enqueue(task), first);
  h.queue.enqueue({ ...task, key: 'other' });
  assert.equal([...h.turns.keys()][0], scheduled);
  await h.flush(); assert.equal(calls, 2); assert.equal((await first.result).state, 'done');
  assert.equal(h.timers.size, 0); h.queue.dispose();
});

test('queue capacity and expiry reject excess/stale work without invoking it or retaining payloads', async () => {
  const h = harness(1, 1000); let calls = 0;
  const first = h.queue.enqueue({ lane: 'analysis', key: 'private-image-url', run: () => { calls++; } });
  const full = h.queue.enqueue({ lane: 'history', key: 'private-commute', run: () => { calls++; } });
  assert.equal((await full.result).state, 'full');
  h.advance(1000);
  assert.equal((await first.result).state, 'expired');
  await h.flush(); assert.equal(calls, 0);
  assert.deepEqual(h.queue.stats(), { waiting: 0, running: { analysis: 0, history: 0, notifications: 0 } });
  assert.ok(!JSON.stringify(h.failures).includes('private'));
  assert.equal(h.timers.size, 0); h.queue.dispose();
});

test('cancellation holds a physical slot until work stops and old cleanup cannot delete its replacement key', async () => {
  const h = harness(), answer = deferred<number>(); let calls = 0; let signal!: AbortSignal;
  const old = h.queue.enqueue({ lane: 'analysis', key: 'camera', run: s => { signal = s; calls++; return answer.promise; } });
  await h.flush(); old.cancel(); assert.equal(signal.aborted, true);
  const next = h.queue.enqueue({ lane: 'analysis', key: 'camera', run: () => { calls++; return 2; } });
  await h.flush(); assert.equal(calls, 1, 'ignoring cancellation cannot allow overlapping model calls');
  assert.notEqual(next, old);
  answer.resolve(1); await h.flush();
  assert.equal((await old.result).state, 'cancelled'); assert.deepEqual(await next.result, { state: 'done', value: 2 });
  assert.equal(calls, 2); assert.equal(h.timers.size, 0); h.queue.dispose();
});

test('only explicitly idempotent work retries with backoff; history/delivery failures run once and redact exceptions', async () => {
  const h = harness(); let reads = 0, mutations = 0;
  const read = h.queue.enqueue({ lane: 'analysis', key: 'photo', retry: { maxAttempts: 2, delayMs: 5000 }, run: () => {
    if (++reads === 1) throw new Error('private exception'); return 8;
  } });
  const write = h.queue.enqueue({ lane: 'history', key: 'receipt', run: () => { mutations++; throw new Error('private exception'); } });
  await h.flush(); assert.equal(reads, 1); assert.equal(mutations, 1); assert.equal((await write.result).state, 'failed');
  h.advance(4999); await h.flush(); assert.equal(reads, 1);
  h.advance(1); await h.flush(); assert.equal(reads, 2); assert.deepEqual(await read.result, { state: 'done', value: 8 });
  assert.ok(!JSON.stringify(h.failures).includes('private')); h.queue.dispose();
});

test('deadline/disposal cancels queued and backoff work, with no timer leaks or late retries', async () => {
  const h = harness(32, 1000); let calls = 0;
  const task = h.queue.enqueue({ lane: 'analysis', key: 'photo', retry: { maxAttempts: 3, delayMs: 500 }, run: () => { calls++; throw new Error(); } });
  await h.flush(); h.advance(500); await h.flush(); assert.equal(calls, 2);
  assert.equal((await task.result).state, 'failed', 'a retry at the deadline is not admitted');
  const queued = h.queue.enqueue({ lane: 'history', key: 'history', run: () => { assert.fail('disposed work started'); } });
  h.queue.dispose(); assert.equal((await queued.result).state, 'cancelled');
  h.advance(10000); await h.flush(); assert.equal(calls, 2); assert.equal(h.timers.size, 0);
  assert.equal((await h.queue.enqueue({ lane: 'history', key: 'new', run() {} }).result).state, 'cancelled');
});

test('photo replacement discards old results, prioritizes selected cameras and stops publication after disposal', async () => {
  const h = harness(), old = deferred<number>(); const starts: string[] = []; const snapshots: any[] = [];
  const resource = createVehicleJobs({ queue: h.queue, owner: 'test', retryMs: 10, publish: state => snapshots.push(state),
    count: async (url, signal) => { starts.push(url); if (url === 'old') { await old.promise; signal.throwIfAborted(); } return url === 'new' ? 5 : 3; } });
  resource.update([{ id: 'a', imageUrl: 'old' }, { id: 'b', imageUrl: 'b' }], { enabled: true, visible: true });
  await h.flush(); assert.deepEqual(starts, ['old']);
  resource.update([{ id: 'a', imageUrl: 'new' }, { id: 'b', imageUrl: 'b' }], { enabled: true, visible: true });
  old.resolve(99); await h.flush();
  assert.deepEqual(starts, ['old', 'new', 'b']);
  assert.deepEqual(snapshots.at(-1).counts.a, { count: 5, imageUrl: 'new' });
  assert.equal(snapshots.at(-1).status, 'ready');
  resource.dispose(); const before = snapshots.length;
  resource.update([{ id: 'a', imageUrl: 'unused' }], { enabled: true, visible: true });
  await h.flush(); assert.equal(snapshots.length, before); h.queue.dispose();
});

test('hidden/disabled photos start no work and later visibility resumes only current photos', async () => {
  const h = harness(); const starts: string[] = [], snapshots: any[] = [];
  const resource = createVehicleJobs({ queue: h.queue, owner: 'test', retryMs: 10, publish: s => snapshots.push(s), count: async url => { starts.push(url); return 2; } });
  resource.update([{ id: 'a', imageUrl: 'one' }], { enabled: true, visible: false }); await h.flush(); assert.deepEqual(starts, []);
  assert.equal(snapshots.at(-1).status, 'idle');
  resource.update([{ id: 'a', imageUrl: 'two' }], { enabled: false, visible: true }); await h.flush(); assert.equal(snapshots.at(-1).status, 'off');
  resource.update([{ id: 'a', imageUrl: 'three' }], { enabled: true, visible: true }); await h.flush(); assert.deepEqual(starts, ['three']);
  resource.dispose(); h.queue.dispose();
});

test('photo analysis retries twice, exposes failure and never labels a malformed count as a valid result', async () => {
  const h = harness(); let calls = 0; let state: any;
  const resource = createVehicleJobs({ queue: h.queue, owner: 'test', retryMs: 10, publish: s => { state = s; }, count: async () => { calls++; return NaN; } });
  const cameras = [{ id: 'a', imageUrl: 'photo' }];
  resource.update(cameras, { enabled: true, visible: true }); await h.flush(); h.advance(10); await h.flush();
  assert.equal(calls, 2); assert.equal(state.status, 'error'); assert.deepEqual(state.counts, {});
  resource.update(cameras, { enabled: true, visible: true }); await h.flush(); assert.equal(calls, 2, 'same failed photo does not loop');
  resource.dispose(); h.queue.dispose();
});

test('history receipts are deferred, captured, deduplicated and preserve original times; disposal cancels unstarted writes', async () => {
  const h = harness(), writes: any[] = [];
  const history = createHistoryJobs(h.queue, 'one', rows => { writes.push(rows); });
  const rows = [{ id: 'home', routeKey: 'route', minutes: 10, receivedAt: 50 }];
  history.record(rows); history.record(rows); rows[0].minutes = 99;
  assert.equal(writes.length, 0); await h.flush();
  assert.deepEqual(writes, [[{ id: 'home', routeKey: 'route', minutes: 10, receivedAt: 50 }]]);
  history.record([{ ...rows[0], receivedAt: 60 }]); history.dispose(); await h.flush(); assert.equal(writes.length, 1); h.queue.dispose();
});

test('history queue failure has fixed feedback and a later live receipt clears it', async () => {
  const h = harness(); const notices: (string | null)[] = []; let fail = true;
  const history = createHistoryJobs(h.queue, 'history', async () => { if (fail) throw new Error('private'); }, value => notices.push(value));
  history.record([{ id: 'home', routeKey: 'route', minutes: 10, receivedAt: 50 }]); await h.flush();
  assert.match(notices.at(-1)!, /could not be recorded/); assert.ok(!JSON.stringify(notices).includes('private'));
  fail = false; history.record([{ id: 'home', routeKey: 'route', minutes: 11, receivedAt: 60 }]); await h.flush();
  assert.equal(notices.at(-1), null); history.dispose(); h.queue.dispose();
});

test('queued alert attempts retain policy bounds and cancellation prevents dispatch before execution', async () => {
  const h = harness(); let deliveries = 0; const notices: (string | null)[] = [];
  const send = createNotificationJobs(h.queue, 'owner', async () => { deliveries++; return 'failed'; });
  const alert = createCommuteAlertQueue({ send, now: h.now, onNotice: n => notices.push(n),
    schedule: (run, ms) => { const timer = { run, at: h.now() + ms }; h.timers.add(timer); return () => { h.timers.delete(timer); }; } });
  alert.observe([], []);
  const candidate = { key: 'incident', title: 'private', body: 'private' };
  alert.observe(['incident'], [candidate]);
  assert.equal(deliveries, 0); await h.flush();
  assert.match(notices.at(-1)!, /Retrying/);
  h.advance(15000); await h.flush(); h.advance(15000); await h.flush();
  assert.equal(deliveries, 3); assert.match(notices.at(-1)!, /couldn’t be sent/);
  h.advance(15000); await h.flush(); assert.equal(deliveries, 3);
  alert.observe(['incident', 'new'], [candidate, { ...candidate, key: 'new' }]);
  alert.observe(['incident'], [candidate]); await h.flush(); assert.equal(deliveries, 3);
  alert.dispose(); h.queue.dispose();
});

test('revoked permission/cancellation is rechecked after worker lookup before browser delivery or fallback', async () => {
  const worker = deferred<Pick<ServiceWorkerRegistration, 'showNotification'> | undefined>(); let shown = 0;
  const controller = new AbortController();
  const port: NotificationPort = { supported: () => true, permission: () => 'granted', requestPermission: async () => 'granted',
    worker: () => worker.promise, show: () => { shown++; } };
  const sending = sendCommuteNotification('private', 'private', port, controller.signal);
  controller.abort(); worker.resolve({ showNotification: async () => { shown++; } });
  assert.equal(await sending, 'failed'); assert.equal(shown, 0);
  assert.equal(await sendCommuteNotification('private', 'private', { ...port, permission: () => 'denied' }), 'blocked');
  const lateWorker = deferred<Pick<ServiceWorkerRegistration, 'showNotification'> | undefined>();
  let permission: NotificationPermission = 'granted';
  const late = sendCommuteNotification('private', 'private', { ...port, permission: () => permission, worker: () => lateWorker.promise });
  permission = 'denied'; lateWorker.resolve({ showNotification: async () => { shown++; } });
  assert.equal(await late, 'blocked'); assert.equal(shown, 0);

});

test('image cancellation removes the source/handlers and pre-aborted work starts no image request', async () => {
  const controller = new AbortController(); let created = 0, removed = 0;
  const image = { src: '', onload: null, onerror: null, removeAttribute() { removed++; } } as unknown as HTMLImageElement;
  const pending = loadImage('https://example.test/fixture.jpg', 1000, () => { created++; return image; }, controller.signal);
  const rejected = assert.rejects(pending, error => error instanceof DOMException && error.name === 'AbortError');
  await tick(); controller.abort(); await rejected;
  assert.equal(removed, 1); assert.equal(image.onload, null); assert.equal(image.onerror, null);
  await assert.rejects(loadImage('https://example.test/fixture.jpg', 1000, () => { created++; return image; }, controller.signal));
  assert.equal(created, 1);
});

test('queue configuration validates bounds and exposes only typed public settings', () => {
  const defaults = createPublicConfig(); assert.deepEqual(defaults.background, { maxPending: 32, idleTimeoutMs: 1000, maxAgeMs: 120000 });
  assert.deepEqual(createPublicConfig({ VITE_BACKGROUND_MAX_PENDING: '8', VITE_BACKGROUND_IDLE_TIMEOUT_MS: '200', VITE_BACKGROUND_JOB_MAX_AGE_MS: '1000' }).background,
    { maxPending: 8, idleTimeoutMs: 200, maxAgeMs: 1000 });
  for (const [key, value] of [['VITE_BACKGROUND_MAX_PENDING', '3'], ['VITE_BACKGROUND_IDLE_TIMEOUT_MS', '0'], ['VITE_BACKGROUND_JOB_MAX_AGE_MS', '999']])
    assert.throws(() => createPublicConfig({ [key]: value }), error => error instanceof Error && error.message.includes(key));
});
