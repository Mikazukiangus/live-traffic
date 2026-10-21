import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPolledResource } from '../src/features/feeds/polledResource.ts';
import { FeedHttpError, type FeedResponse } from '../src/utils/feedResponse.ts';
import { isTravelTimeFeed } from '../src/utils/ltaTravelTimes.ts';
import { isAirQuality } from '../src/utils/airQuality.ts';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const travel = () => ({
  value: [{ Name: 'PIE', Direction: 1, FarEndPoint: 'TUAS', StartPoint: 'A', EndPoint: 'B', EstTime: 5 }],
});
const air = () => ({
  psiTimestamp: '2026-10-21T10:00:00+08:00',
  pm25Timestamp: null,
  regions: [{ name: 'north', lat: 1.44, lon: 103.77, psi24h: 30, pm25OneHour: null, pm25TwentyFourHour: 10 }],
});
function harness() {
  let now = 1000;
  let calls = 0;
  let listener: (() => void) | undefined;
  let answer: () => Promise<FeedResponse<unknown>> = async () => ({
    data: travel(),
    offline: false,
    receivedAt: now,
  });
  const timers = new Map<() => void, number>();
  const resource = createPolledResource(
    { url: '/api/traveltimes', pollMs: 100, isValid: isTravelTimeFeed },
    {
      now: () => now,
      fetch: async () => {
        calls++;
        return answer();
      },
      retryMs: 10,
      schedule: (fn, ms) => {
        timers.set(fn, now + ms);
        return () => {
          timers.delete(fn);
        };
      },
      onRefresh: (fn) => {
        assert.equal(listener, undefined, 'one global refresh listener per feed');
        listener = fn;
        return () => {
          listener = undefined;
        };
      },
    },
  );
  return {
    resource,
    timers,
    calls: () => calls,
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
    reply: (fn: typeof answer) => {
      answer = fn;
    },
    refreshEvent: () => listener?.(),
    hasListener: () => !!listener,
    runTimer: () => {
      const next = [...timers].sort((a, b) => a[1] - b[1])[0];
      assert.ok(next);
      timers.delete(next[0]);
      now = Math.max(now, next[1]);
      next[0]();
    },
  };
}

test('shared feeds reuse the completed snapshot on remount and share one timer/listener', async () => {
  const h = harness();
  const a = h.resource.connect(() => {});
  const b = h.resource.connect(() => {});
  await tick();
  assert.equal(h.calls(), 1);
  assert.equal(h.timers.size, 1);
  const first = h.resource.getSnapshot();
  a();
  b();
  assert.equal(h.timers.size, 0);
  assert.equal(h.hasListener(), false);
  h.advance(50);
  const next = h.resource.connect(() => {});
  assert.equal(h.resource.getSnapshot(), first, 'no loading reset or renewed receipt timestamp');
  await tick();
  assert.equal(h.calls(), 1);
  assert.deepEqual([...h.timers.values()], [1100], 'reuse the original deadline');
  next();
  h.advance(51);
  const expired = h.resource.connect(() => {});
  await tick();
  assert.equal(h.calls(), 2);
  assert.equal(h.resource.getSnapshot().fetchedAt, 1101);
  expired();
});

test('concurrent explicit refreshes, subscriptions and refresh events coalesce', async () => {
  const h = harness();
  let release!: () => void;
  h.reply(
    () =>
      new Promise((resolve) => {
        release = () => resolve({ data: travel(), offline: false, receivedAt: h.now() });
      }),
  );
  const a = h.resource.connect(() => {});
  await tick();
  const first = h.resource.refresh();
  assert.equal(h.resource.refresh(), first);
  const b = h.resource.connect(() => {});
  h.refreshEvent();
  await tick();
  assert.equal(h.calls(), 1);
  assert.equal(h.timers.size, 0);
  release();
  await first;
  assert.equal(h.timers.size, 1);
  a();
  b();
});

test('shared feed retries initial errors, validates rows and retains the last good observation', async () => {
  const h = harness();
  h.reply(async () => ({ data: { value: [{}] }, offline: false, receivedAt: h.now() }));
  const stop = h.resource.connect(() => {});
  await tick();
  assert.equal(h.resource.getSnapshot().status, 'loading');
  assert.equal(h.resource.getSnapshot().data, null);
  h.runTimer();
  await tick();
  assert.equal(h.resource.getSnapshot().status, 'error');
  h.reply(async () => ({ data: travel(), offline: false, receivedAt: h.now() }));
  h.runTimer();
  await tick();
  const first = h.resource.getSnapshot();
  assert.equal(first.status, 'live');
  h.advance(10);
  h.reply(async () => {
    throw new Error('synthetic-private-response');
  });
  await h.resource.refresh();
  assert.equal(h.resource.getSnapshot().status, 'error');
  assert.equal(h.resource.getSnapshot().data, first.data);
  assert.equal(h.resource.getSnapshot().fetchedAt, first.fetchedAt);
  assert.ok(!JSON.stringify(h.resource.getSnapshot()).includes('private'));
  stop();
});

test('offline copies keep their saved receipt and cannot replace a known network observation', async () => {
  const h = harness();
  h.reply(async () => ({ data: travel(), offline: true, receivedAt: 20 }));
  const stop = h.resource.connect(() => {});
  await tick();
  assert.equal(h.resource.getSnapshot().fetchedAt, 20);
  assert.equal(h.resource.getSnapshot().offline, true);
  assert.equal(h.resource.getSnapshot().status, 'error');
  h.reply(async () => ({ data: travel(), offline: false, receivedAt: h.now() }));
  await h.resource.refresh();
  const network = h.resource.getSnapshot();
  h.advance(10);
  h.reply(async () => ({ data: { value: [] }, offline: true, receivedAt: h.now() }));
  await h.resource.refresh();
  assert.equal(h.resource.getSnapshot().data, network.data);
  assert.equal(h.resource.getSnapshot().fetchedAt, network.fetchedAt);
  assert.equal(h.resource.getSnapshot().status, 'error');
  stop();
});

test('Retry-After cooldown survives unmount/remount and explicit refreshes', async () => {
  const h = harness();
  h.reply(async () => {
    throw new FeedHttpError(429, 1200);
  });
  const stop = h.resource.connect(() => {});
  await tick();
  stop();
  h.advance(20);
  const remount = h.resource.connect(() => {});
  await tick();
  h.refreshEvent();
  await h.resource.refresh();
  assert.equal(h.calls(), 1);
  assert.deepEqual([...h.timers.values()], [1200]);
  h.reply(async () => ({ data: travel(), offline: false, receivedAt: h.now() }));
  h.runTimer();
  await tick();
  assert.equal(h.calls(), 2);
  assert.equal(h.resource.getSnapshot().status, 'live');
  remount();
});

test('late shared-feed completion after disposal retains data without restarting timers', async () => {
  const h = harness();
  let release!: () => void;
  h.reply(
    () =>
      new Promise((resolve) => {
        release = () => resolve({ data: travel(), offline: false, receivedAt: h.now() });
      }),
  );
  const stop = h.resource.connect(() => {});
  await tick();
  stop();
  release();
  await tick();
  assert.equal(h.resource.getSnapshot().status, 'live');
  assert.equal(h.resource.getSnapshot().refreshing, false);
  assert.equal(h.timers.size, 0);
  assert.equal(h.hasListener(), false);
  const remount = h.resource.connect(() => {});
  await tick();
  assert.equal(h.calls(), 1);
  remount();
  const canceled = h.resource.connect(() => {});
  canceled();
  await tick();
  assert.equal(h.calls(), 1);
  assert.equal(h.timers.size, 0);
});

test('travel-time and air-quality cache guards reject malformed fields without rejecting valid empty/partial feeds', () => {
  assert.ok(isTravelTimeFeed(travel()));
  assert.ok(isTravelTimeFeed({ value: [] }));
  for (const bad of [
    null,
    {},
    { value: [{}] },
    ...[
      { EstTime: NaN },
      { EstTime: -1 },
      { Direction: '1' },
      { Name: '' },
      { EndPoint: 123 },
      { FarEndPoint: null },
    ].map((change) => ({ value: [{ ...travel().value[0], ...change }] })),
  ])
    assert.equal(isTravelTimeFeed(bad), false);
  assert.ok(isAirQuality(air()), 'one unavailable upstream remains a usable partial response');
  assert.ok(
    isAirQuality({ ...air(), psiTimestamp: null, regions: [{ ...air().regions[0], lat: null, lon: null }] }),
  );
  for (const bad of [
    null,
    {},
    { ...air(), regions: [] },
    { ...air(), psiTimestamp: 'private-invalid' },
    { ...air(), regions: [air().regions[0], air().regions[0]] },
    ...[{ name: 'unknown' }, { psi24h: NaN }, { pm25OneHour: -1 }, { lat: 100 }, { lon: '103.77' }].map(
      (change) => ({ ...air(), regions: [{ ...air().regions[0], ...change }] }),
    ),
  ])
    assert.equal(isAirQuality(bad), false);
});
