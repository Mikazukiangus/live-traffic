import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  commuteRouteKey,
  decodeCommutes,
  decodeHistories,
  HISTORY_KEEP_MS,
  isCommute,
  type Commute,
} from '../shared/commutes/model.ts';
import { COMMUTE_STORAGE_KEYS as K, createCommuteRepository } from '../src/features/commutes/commuteRepository.ts';
import { trendOf } from '../src/utils/commuteHistory.ts';

const CODES = new Set(['PIE', 'AYE', 'KPE', 'MCE']);
const route = (id = 'home'): Commute => ({
  id,
  name: 'Home to work',
  alerts: false,
  legs: [{ code: 'PIE', direction: 1, from: 'A', to: 'B' }],
});
const t = Date.parse('2026-10-20T00:00:00Z');
function setup(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  let now = t;
  let failKey = '';
  const port = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (k === failKey) throw new Error('synthetic-only');
      data.set(k, v);
    },
  };
  const repo = createCommuteRepository(
    () => port,
    CODES,
    () => now,
  );
  return {
    repo,
    data,
    port,
    time: (value: number) => {
      now = value;
    },
    fail: (key: string) => {
      failKey = key;
    },
  };
}
const saved = (rows: unknown[]) => JSON.stringify({ schemaVersion: 1, commutes: rows });
const histories = (rows: unknown[]) => JSON.stringify({ schemaVersion: 1, histories: rows });

test('legacy valid commutes are recovered without writes, then persist in a versioned new key', () => {
  const legacy = JSON.stringify([route()]);
  const s = setup({ [K.legacyCommutes]: legacy, [K.legacyHistory]: '{"home":[[1,99]]}' });
  assert.deepEqual(s.repo.getSnapshot().commutes, [route()]);
  assert.equal(s.data.size, 2, 'loading must not migrate or overwrite storage');
  assert.match(s.repo.getSnapshot().notice!, /trends will build again/);
  assert.deepEqual(s.repo.samples('home', commuteRouteKey(route())), []);
  assert.equal(s.repo.save({ ...route(), name: 'Renamed' }), true);
  assert.equal(JSON.parse(s.data.get(K.commutes)!).schemaVersion, 1);
  assert.equal(s.data.get(K.legacyCommutes), legacy);
  assert.equal(s.data.get(K.legacyHistory), '{"home":[[1,99]]}');
});

test('commute validator checks IDs, labels, roads, directions, endpoints and existing limits on read and write', () => {
  assert.ok(isCommute(route(), CODES));
  assert.ok(isCommute({ ...route(), legs: [{ code: 'KPE', direction: 0, from: '', to: '' }] }, CODES));
  const bad: unknown[] = [
    null,
    {},
    { ...route(), id: '' },
    { ...route(), name: ' ' },
    { ...route(), name: 'x'.repeat(41) },
    { ...route(), alerts: 'yes' },
    { ...route(), legs: [] },
    { ...route(), legs: Array(5).fill(route().legs[0]) },
    { ...route(), legs: [{ ...route().legs[0], code: 'UNKNOWN' }] },
    { ...route(), legs: [{ ...route().legs[0], direction: 3 }] },
    { ...route(), legs: [{ ...route().legs[0], from: '' }] },
    { ...route(), legs: [{ ...route().legs[0], to: 'a' }] },
    { ...route(), legs: [{ code: 'KPE', direction: 1, from: 'A', to: 'B' }] },
  ];
  const s = setup();
  for (const value of bad) {
    assert.equal(isCommute(value, CODES), false);
    assert.equal(s.repo.save(value), false);
  }
  assert.equal(s.data.size, 0);
  for (const id of ['one', 'two', 'three']) assert.ok(s.repo.save(route(id)));
  assert.equal(s.repo.save(route('four')), false);
  assert.equal(s.repo.getSnapshot().commutes.length, 3);
  assert.ok(s.repo.save({ ...route('two'), name: 'Edited' }));
});

test('legacy partial recovery rejects invalid and duplicate entries, retaining the original copy', () => {
  const raw = JSON.stringify([{ id: 'broken' }, route(), route(), route('two'), route('three'), route('four')]);
  const s = setup({ [K.legacyCommutes]: raw });
  assert.deepEqual(
    s.repo.getSnapshot().commutes.map((c) => c.id),
    ['home', 'two', 'three'],
  );
  assert.match(s.repo.getSnapshot().notice!, /original saved copy/);
  s.repo.save({ ...route(), name: 'Changed' });
  assert.equal(s.data.get(K.legacyCommutes), raw);
  assert.equal(JSON.parse(s.data.get(K.commutes)!).commutes.length, 3);
});

test('malformed or future current stores never throw, never fall back to old deleted data and remain untouched after edits', () => {
  for (const raw of [
    '{',
    '[]',
    'null',
    JSON.stringify({ schemaVersion: 99, commutes: [route()] }),
    saved([route(), { id: 'bad' }]),
  ]) {
    const s = setup({ [K.commutes]: raw, [K.legacyCommutes]: JSON.stringify([route('older')]) });
    assert.ok(s.repo.getSnapshot().commutes.every((c) => c.id !== 'older'));
    assert.ok(s.repo.getSnapshot().notice);
    s.repo.save(route('memory'));
    s.repo.remove('home');
    assert.equal(s.data.get(K.commutes), raw);
    assert.equal(s.data.has(K.history), false);
  }
  assert.equal(decodeCommutes('{', CODES).writable, false);
});

test('history codec rejects malformed entries, invalid samples, duplicates and unsupported versions', () => {
  const good = {
    commuteId: 'home',
    routeKey: commuteRouteKey(route()),
    samples: [
      [t, 20],
      [t + 60_000, 21],
    ],
  };
  assert.equal(decodeHistories(histories([good])).value.length, 1);
  for (const raw of [
    '{',
    '[]',
    'null',
    JSON.stringify({ schemaVersion: 2, histories: [good] }),
    histories([{ ...good, samples: {} }]),
    histories([{ ...good, samples: [[t, -1]] }]),
    histories([
      {
        ...good,
        samples: [
          [t, 20],
          [t, 20],
        ],
      },
    ]),
    histories([
      {
        ...good,
        samples: [
          [t + 1, 20],
          [t, 21],
        ],
      },
    ]),
    histories([{ ...good, samples: [[t, 20, 1]] }]),
    histories([{ ...good, samples: [[t, '20']] }]),
    histories([good, good]),
  ]) {
    assert.equal(decodeHistories(raw).writable, false);
  }
  assert.equal(decodeHistories(histories([good, { ...good, commuteId: 'broken', samples: 'bad' }])).value.length, 1);
  const s = setup({ [K.commutes]: saved([route()]), [K.history]: histories([{ ...good, samples: {} }]) });
  const original = s.data.get(K.history);
  assert.doesNotThrow(() => s.repo.record('home', good.routeKey, 20, t));
  assert.equal(s.data.get(K.history), original);
  assert.ok(s.repo.getSnapshot().notice);
});

test('route edit clears history immediately and prevents stale-route writes and a false easing trend', () => {
  const s = setup();
  const c = route();
  const key = commuteRouteKey(c);
  s.repo.save(c);
  s.repo.record(c.id, key, 30, t);
  s.time(t + 30 * 60_000);
  s.repo.record(c.id, key, 30, t + 30 * 60_000);
  assert.equal(s.repo.samples(c.id, key).length, 2);
  const changed = { ...c, legs: [{ code: 'AYE', direction: 1, from: 'C', to: 'D' }] };
  s.repo.save(changed);
  assert.deepEqual(s.repo.samples(c.id, key), []);
  assert.deepEqual(s.repo.record(c.id, key, 30, t + 30 * 60_000), []);
  const fresh = s.repo.record(c.id, commuteRouteKey(changed), 10, t + 30 * 60_000);
  assert.equal(fresh.length, 1);
  assert.equal(trendOf(fresh, t + 30 * 60_000), null);
  s.repo.save(c);
  assert.deepEqual(s.repo.samples(c.id, key), [], 'A to B to A must not restore stale A history');
  const reload = createCommuteRepository(
    () => s.port,
    CODES,
    () => t + 30 * 60_000,
  );
  assert.deepEqual(reload.samples(c.id, key), []);
});

test('rename, alerts and endpoint capitalization/spacing preserve history; direction, endpoint and leg order reset it', () => {
  const s = setup();
  const c = route();
  s.repo.save(c);
  const key = commuteRouteKey(c);
  s.repo.record(c.id, key, 20, t);
  s.repo.save({ ...c, name: 'Other name', alerts: true, legs: [{ ...c.legs[0], from: ' a ', to: 'b' }] });
  assert.equal(s.repo.samples(c.id, key).length, 1);
  for (const legs of [
    [{ ...c.legs[0], direction: 2 }],
    [{ ...c.legs[0], to: 'C' }],
    [c.legs[0], { code: 'KPE', direction: 0, from: '', to: '' }],
  ]) {
    s.repo.save({ ...c, legs });
    assert.deepEqual(s.repo.samples(c.id, key), []);
    s.repo.save(c);
    s.repo.record(c.id, key, 20, t);
  }
  const two = { ...c, legs: [c.legs[0], { code: 'KPE', direction: 0, from: '', to: '' }] };
  s.repo.save(two);
  const twoKey = commuteRouteKey(two);
  s.repo.record(c.id, twoKey, 20, t);
  s.repo.save({ ...two, legs: [...two.legs].reverse() });
  assert.deepEqual(s.repo.samples(c.id, twoKey), []);
});

test('sample receipts deduplicate, reject bad or future values and prune expired/out-of-order samples', () => {
  const s = setup();
  const c = route();
  const key = commuteRouteKey(c);
  s.repo.save(c);
  for (const [at, min] of [
    [t, NaN],
    [t, Infinity],
    [t, -1],
    [t + 1, 20],
  ]) {
    assert.deepEqual(s.repo.record(c.id, key, min, at), []);
  }
  s.repo.record(c.id, key, 20, t);
  s.repo.record(c.id, key, 20, t);
  s.time(t + 5 * 60_000);
  assert.equal(s.repo.record(c.id, key, 20, t + 5 * 60_000).length, 2);
  assert.equal(s.repo.record(c.id, key, 100, t + 60_000).length, 2, 'out of order ignored');
  s.time(t + HISTORY_KEEP_MS + 5 * 60_000 + 1);
  assert.deepEqual(s.repo.samples(c.id, key), []);
  assert.deepEqual(s.repo.record(c.id, key, 20, t), []);
  assert.deepEqual(s.repo.record('missing', key, 20, t), []);
});

test('deletion persists an empty v1 store, removes samples and does not resurrect the legacy commute on reload', () => {
  const s = setup({ [K.legacyCommutes]: JSON.stringify([route()]) });
  const key = commuteRouteKey(route());
  s.repo.record('home', key, 20, t);
  s.repo.remove('home');
  const reload = createCommuteRepository(
    () => s.port,
    CODES,
    () => t,
  );
  assert.deepEqual(reload.getSnapshot().commutes, []);
  assert.deepEqual(reload.samples('home', key), []);
  assert.equal(JSON.parse(s.data.get(K.history)!).histories.length, 0);
});

test('blocked reads or quota failures keep edits and route-safe history in memory, without raw diagnostics', () => {
  const blocked = createCommuteRepository(
    () => {
      throw new Error('private synthetic detail');
    },
    CODES,
    () => t,
  );
  assert.ok(blocked.save(route()));
  assert.equal(blocked.record('home', commuteRouteKey(route()), 20, t).length, 1);
  assert.match(blocked.getSnapshot().notice!, /only in this tab/);
  assert.ok(!blocked.getSnapshot().notice!.includes('private'));
  const s = setup();
  s.fail(K.commutes);
  s.repo.save(route());
  s.repo.record('home', commuteRouteKey(route()), 20, t);
  assert.match(
    s.repo.getSnapshot().notice!,
    /unavailable/,
    'a successful history write cannot conceal a failed commute write',
  );
  s.fail('');
  s.repo.save({ ...route(), name: 'Recovered' });
  assert.equal(s.repo.getSnapshot().notice, null);
});

test('repository snapshots stay stable until changes and notify every subscriber, with safe prototype-like IDs', () => {
  const s = setup();
  let count = 0;
  const unsubscribe = s.repo.subscribe(() => count++);
  const before = s.repo.getSnapshot();
  assert.equal(s.repo.getSnapshot(), before);
  s.repo.save(route('__proto__'));
  assert.notEqual(s.repo.getSnapshot(), before);
  assert.equal(count, 1);
  const c = route('__proto__');
  s.repo.record(c.id, commuteRouteKey(c), 20, t);
  assert.equal(count, 2);
  unsubscribe();
  s.repo.remove(c.id);
  assert.equal(count, 2);
});
