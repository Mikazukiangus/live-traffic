import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCoordinatedCommutes, COMMUTE_STATE_KEY } from '../src/features/commutes/coordinatedCommutes.ts';
import { COMMUTE_STORAGE_KEYS as K, createCommuteRepository } from '../src/features/commutes/commuteRepository.ts';
import { commuteRouteKey, type Commute } from '../shared/commutes/model.ts';
import { createWakeLockResource } from '../src/utils/wakeLockResource.ts';

const codes = new Set(['PIE', 'KPE']);
const time = Date.parse('2026-10-24T01:00:00Z');
const route = (id = 'home'): Commute => ({ id, name: id, alerts: false, legs: [{ code: 'PIE', direction: 1, from: 'A', to: 'B' }] });
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const listeners = new Set<() => void>();
  const writes: string[] = [];
  let gate: Promise<unknown> = Promise.resolve();
  let paused: Promise<void> | undefined;
  let broken = false;
  let inLock = false;
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => {
    assert.equal(inLock, true, 'all durable mutations must hold the shared lock');
    if (broken) throw new Error('synthetic quota secret');
    writes.push(key); data.set(key, value);
  } };
  const exclusive = <T>(work: () => T): Promise<T> => {
    const ticket = gate.then(async () => {
      if (paused) await paused;
      assert.equal(inLock, false);
      inLock = true;
      try { return work(); } finally { inLock = false; }
    });
    gate = ticket.catch(() => {});
    return ticket;
  };
  const tab = (locks = true) => createCoordinatedCommutes({ storage: () => storage, exclusive: locks ? exclusive : undefined,
    onChange: refresh => { listeners.add(refresh); return () => { listeners.delete(refresh); }; }, now: () => time }, codes);
  return { data, writes, tab, listeners,
    change: () => listeners.forEach(fn => fn()),
    pause: (promise?: Promise<void>) => { paused = promise; },
    breakStorage: () => { broken = true; },
    state: () => JSON.parse(data.get(COMMUTE_STATE_KEY)!),
  };
}

test('old tab-local repositories reproduce lost updates; coordinated tabs preserve concurrent creates', async () => {
  const oldData = new Map<string, string>();
  const port = { getItem: (key: string) => oldData.get(key) ?? null, setItem: (key: string, value: string) => { oldData.set(key, value); } };
  const first = createCommuteRepository(() => port, codes), second = createCommuteRepository(() => port, codes);
  first.save(route('one')); second.save(route('two'));
  assert.equal(JSON.parse(oldData.get(K.commutes)!).commutes.length, 1, 'baseline reproduction');
  const h = harness(), a = h.tab(), b = h.tab();
  assert.deepEqual(await Promise.all([a.saveDetails('one', 'One', route().legs, true), b.saveDetails('two', 'Two', route().legs, true)]), [true, true]);
  assert.deepEqual(h.state().commutes.commutes.map((c: Commute) => c.id), ['one', 'two']);
  assert.deepEqual(h.writes, [COMMUTE_STATE_KEY, COMMUTE_STATE_KEY]);
  assert.equal(h.state().revision, 2);
});

test('cross-tab alert and route edits patch latest fields and commit history invalidation together', async () => {
  const h = harness(), a = h.tab(), b = h.tab();
  await a.save(route());
  const oldRoute = commuteRouteKey(a.getSnapshot().commutes[0]);
  await a.recordBatch([{ id: 'home', routeKey: oldRoute, minutes: 10, receivedAt: time }]);
  await Promise.all([b.setAlerts('home', true), a.saveDetails('home', 'Edited', [{ code: 'KPE', direction: 0, from: '', to: '' }])]);
  const saved = h.state();
  assert.equal(saved.commutes.commutes[0].alerts, true);
  assert.equal(saved.commutes.commutes[0].name, 'Edited');
  assert.equal(saved.commutes.commutes[0].routeRevision, 1);
  assert.deepEqual(saved.history.histories, []);
  const writes = h.writes.length;
  await b.recordBatch([{ id: 'home', routeKey: oldRoute, minutes: 99, receivedAt: time }]);
  assert.deepEqual(h.state().history.histories, []);
  assert.equal(h.writes.length, writes, 'a stale receipt does not write or renew data');
});

test('queued stale edits/receipts cannot resurrect deletion, and create collisions respect capacity', async () => {
  const h = harness(), a = h.tab(), b = h.tab();
  await a.save(route());
  const key = commuteRouteKey(a.getSnapshot().commutes[0]);
  const deletion = a.remove('home');
  const permission = b.setAlerts('home', true);
  const edit = b.saveDetails('home', 'Late editor', route().legs);
  const sample = b.recordBatch([{ id: 'home', routeKey: key, minutes: 9, receivedAt: time }]);
  await deletion; assert.equal(await permission, false); assert.equal(await edit, false); await sample;
  assert.deepEqual(h.state().commutes.commutes, []); assert.deepEqual(h.state().history.histories, []);
  assert.deepEqual(await Promise.all([a.saveDetails('one', 'One', route().legs, true), b.saveDetails('one', 'Collision', route().legs, true)]), [true, false]);
  await Promise.all([a.saveDetails('two', 'Two', route().legs, true), b.saveDetails('three', 'Three', route().legs, true)]);
  assert.equal(await b.saveDetails('four', 'Four', route().legs, true), false);
});

test('history writers merge current receipts without losing another tab’s samples', async () => {
  const h = harness(), a = h.tab(), b = h.tab();
  await a.save(route());
  const key = commuteRouteKey(a.getSnapshot().commutes[0]);
  await Promise.all([a.recordBatch([{ id: 'home', routeKey: key, minutes: 9, receivedAt: time - 120000 }]), b.recordBatch([{ id: 'home', routeKey: key, minutes: 12, receivedAt: time }])]);
  assert.deepEqual(h.state().history.histories[0].samples, [[time - 120000, 9], [time, 12]]);
});

test('migration preserves original copies and commits a complete new envelope only on valid mutation', async () => {
  const legacy = JSON.stringify([route()]);
  const h = harness({ [K.legacyCommutes]: legacy, [K.legacyHistory]: '{"home":[[1,2]]}' });
  const a = h.tab();
  assert.equal(h.writes.length, 0);
  await a.setAlerts('missing', true);
  assert.equal(h.writes.length, 0);
  await a.setAlerts('home', true);
  assert.equal(h.data.get(K.legacyCommutes), legacy);
  assert.equal(h.data.get(K.legacyHistory), '{"home":[[1,2]]}');
  assert.equal(h.state().commutes.schemaVersion, 1);
  assert.deepEqual(h.state().history, { schemaVersion: 1, histories: [] });
  assert.equal(h.tab().getSnapshot().commutes[0].alerts, true);
  // Older deployed tabs write v1 only; they cannot overwrite the new authoritative key.
  h.data.set(K.commutes, JSON.stringify({ schemaVersion: 1, commutes: [] }));
  assert.equal(h.tab().getSnapshot().commutes.length, 1);
});

test('versioned v1 migration keeps samples and a failed route commit cannot split stored route/history', async () => {
  const commute = { ...route(), routeRevision: 0 }, key = commuteRouteKey(commute);
  const oldCommutes = JSON.stringify({ schemaVersion: 1, commutes: [commute] });
  const oldHistory = JSON.stringify({ schemaVersion: 1, histories: [{ commuteId: 'home', routeKey: key, samples: [[time, 10]] }] });
  const h = harness({ [K.commutes]: oldCommutes, [K.history]: oldHistory }), a = h.tab();
  await a.setAlerts('home', true);
  assert.deepEqual(h.state().history.histories[0].samples, [[time, 10]]);
  const committed = h.data.get(COMMUTE_STATE_KEY);
  h.breakStorage();
  await a.saveDetails('home', 'New route', [{ code: 'KPE', direction: 0, from: '', to: '' }]);
  assert.equal(h.data.get(COMMUTE_STATE_KEY), committed);
  const b = h.tab();
  assert.equal(b.getSnapshot().commutes[0].legs[0].code, 'PIE');
  assert.deepEqual(b.samples('home', key), [[time, 10]]);
  assert.equal(a.getSnapshot().commutes[0].legs[0].code, 'KPE');
  assert.deepEqual(a.samples('home', key), []);
  assert.equal(h.data.get(K.commutes), oldCommutes);
  assert.equal(h.data.get(K.history), oldHistory);
});

test('malformed/unknown saved envelopes are preserved while local edits remain usable', async () => {
  for (const raw of ['{bad', '{"schemaVersion":99}', ...[Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1].map(revision => JSON.stringify({ schemaVersion: 2, revision, commutes: { schemaVersion: 1, commutes: [route()] }, history: { schemaVersion: 1, histories: [] } })), JSON.stringify({ schemaVersion: 2, revision: 1, commutes: { schemaVersion: 1, commutes: [route(), {}] }, history: { schemaVersion: 1, histories: [] } })]) {
    const h = harness({ [COMMUTE_STATE_KEY]: raw }), a = h.tab();
    await a.save(route('local'));
    assert.equal(h.data.get(COMMUTE_STATE_KEY), raw);
    assert.equal(h.writes.length, 0);
    assert.match(a.getSnapshot().notice!, /stored copy was kept/);
    assert.ok(a.getSnapshot().commutes.some(c => c.id === 'local'));
  }
});

test('storage changes reload the current envelope, preserve stable snapshots and detach listeners', async () => {
  const h = harness(), a = h.tab(), b = h.tab();
  let notifications = 0;
  const stop = a.subscribe(() => { notifications++; });
  const before = a.getSnapshot();
  h.change(); assert.equal(a.getSnapshot(), before);
  await b.save(route()); h.change();
  assert.equal(a.getSnapshot().commutes.length, 1);
  assert.equal(notifications, 1);
  const commutes = a.getSnapshot().commutes;
  await b.recordBatch([{ id: 'home', routeKey: commuteRouteKey(commutes[0]), minutes: 10, receivedAt: time }]); h.change();
  assert.equal(a.getSnapshot().commutes, commutes, 'history changes must not restart receipt effects');
  assert.equal(a.samples('home', commuteRouteKey(commutes[0])).length, 1);
  assert.equal(notifications, 2);
  stop(); assert.equal(h.listeners.size, 0);
});

test('failed shared writes retain local edits without replaying them over later successful tabs', async () => {
  const h = harness(), a = h.tab(), b = h.tab();
  await a.save(route());
  const persisted = h.data.get(COMMUTE_STATE_KEY);
  h.breakStorage();
  await a.setAlerts('home', true);
  assert.equal(h.data.get(COMMUTE_STATE_KEY), persisted);
  assert.equal(a.getSnapshot().commutes[0].alerts, true);
  assert.match(a.getSnapshot().notice!, /only in this tab/);
  h.change();
  await a.saveDetails('home', 'Local only', route().legs);
  assert.equal(a.getSnapshot().commutes[0].alerts, true);
  assert.equal(h.data.get(COMMUTE_STATE_KEY), persisted);
  assert.equal(b.getSnapshot().commutes.length, 0);
});

test('missing/rejected locks never fall back to uncoordinated persistent writes or raw diagnostics', async () => {
  const h = harness(), a = h.tab(false);
  await a.save(route());
  assert.equal(h.writes.length, 0);
  assert.match(a.getSnapshot().notice!, /only in this tab/);
  const b = createCoordinatedCommutes({ storage: () => ({ getItem: () => null, setItem: () => { assert.fail('must not write'); } }), exclusive: async () => { throw new Error('synthetic secret'); }, now: () => time, onChange: () => () => {} }, codes);
  await b.save(route());
  assert.equal(b.getSnapshot().commutes.length, 1);
  assert.ok(!b.getSnapshot().notice!.includes('secret'));
});

test('queued commands capture their inputs before lock admission', async () => {
  const h = harness(), gate = deferred<void>(), a = h.tab();
  h.pause(gate.promise);
  const draft = route();
  const save = a.save(draft);
  await tick();
  draft.name = 'Mutated'; draft.legs[0].code = 'KPE';
  assert.equal(h.writes.length, 0);
  gate.resolve(); await save;
  assert.equal(h.state().commutes.commutes[0].name, 'home');
  assert.equal(h.state().commutes.commutes[0].legs[0].code, 'PIE');
});

function lock() {
  let released = false, releases = 0;
  let onRelease!: () => void;
  const value = {
    get released() { return released; },
    release: async () => { releases++; released = true; onRelease?.(); },
    addEventListener: (_event: string, fn: () => void) => { onRelease = fn; },
  } as unknown as WakeLockSentinel;
  return { value, releases: () => releases, markReleased: () => { released = true; }, event: () => onRelease?.() };
}

test('wake lock admission coalesces overlapping requests and dispose releases late acquisitions', async () => {
  const pending = deferred<WakeLockSentinel>(), sentinel = lock();
  let calls = 0; const held: boolean[] = [];
  const resource = createWakeLockResource({ request: () => { calls++; return pending.promise; }, visible: () => true, held: value => { held.push(value); } });
  const first = resource.take(); assert.equal(resource.take(), first); assert.equal(calls, 1);
  resource.dispose(); const before = [...held];
  pending.resolve(sentinel.value); await first;
  assert.equal(sentinel.releases(), 1);
  assert.deepEqual(held, before, 'disposed completion cannot republish state');
});

test('stale wake release and hidden completions cannot clear a newer active owner', async () => {
  const a = lock(), b = lock(); let calls = 0; let visible = true;
  const held: boolean[] = [];
  const resource = createWakeLockResource({ request: async () => (++calls === 1 ? a : b).value, visible: () => visible, held: value => { held.push(value); } });
  await resource.take(); a.markReleased(); await resource.take();
  const before = [...held]; a.event(); assert.deepEqual(held, before);
  b.event(); assert.equal(held.at(-1), false);
  resource.dispose();
  const late = deferred<WakeLockSentinel>(), hidden = lock();
  const next = createWakeLockResource({ request: () => late.promise, visible: () => visible, held: value => { held.push(value); } });
  const pending = next.take(); visible = false; late.resolve(hidden.value); await pending;
  assert.equal(hidden.releases(), 1); assert.equal(held.at(-1), false);
  next.dispose();
});


test('a disposed wake-lock rejection cannot clear another resource holding the screen', async () => {
  const old = deferred<WakeLockSentinel>(), current = lock();
  const held: boolean[] = [];
  const first = createWakeLockResource({ request: () => old.promise, visible: () => true, held: value => { held.push(value); } });
  const pending = first.take(); first.dispose();
  const next = createWakeLockResource({ request: async () => current.value, visible: () => true, held: value => { held.push(value); } });
  await next.take();
  const before = [...held];
  old.reject(new Error('synthetic refusal')); await pending;
  assert.deepEqual(held, before);
  assert.equal(held.at(-1), true);
  next.dispose();
});
