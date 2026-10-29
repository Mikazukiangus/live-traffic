import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { installDom, deferred, settleDom } from './helpers/dom.ts';
import { useRainFeed } from '../src/features/weather/useRainFeed.ts';
import { useRainForecast } from '../src/utils/rainForecast.ts';
import { useWeatherAlerts } from '../src/utils/weatherAlerts.ts';
import { getBackgroundQueue, backgroundOwner } from '../src/features/background/browserQueue.ts';
import { recoveryRootOptions } from '../src/features/app/errorReporting.ts';
import { config } from '../config/client.ts';

function manualTimers() {
  const before = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  let id = 0; const timers = new Map<number, { run: () => void; ms: number }>();
  globalThis.setTimeout = ((run: () => void, ms: number) => { timers.set(++id, { run, ms }); return id; }) as any;
  globalThis.clearTimeout = ((id: number) => { timers.delete(id); }) as any;
  return { timers, fire(id: number) { const timer = timers.get(id)!; timers.delete(id); timer.run(); },
    restore() { globalThis.setTimeout = before.setTimeout; globalThis.clearTimeout = before.clearTimeout; } };
}
const rainPayload = (forecast = 'Heavy Rain') => ({ issuedAt: '2026-10-29T09:00:00+08:00',
  validPeriod: { start: '2026-10-29T09:00:00+08:00', end: '2026-10-29T11:00:00+08:00', text: '9am to 11am' },
  areas: [{ name: 'City', forecast, lat: 1.3, lon: 103.8 }] });

test('mounted rain consumers share requests, preserve observation age through failure/offline fallback, recover and detach', async () => {
  const dom = installDom(), timers = manualTimers(), originalFetch = globalThis.fetch;
  const first = deferred<Response>(); let answer = first.promise, calls = 0;
  let state!: ReturnType<typeof useRainFeed>, forecast!: ReturnType<typeof useRainForecast>;
  globalThis.fetch = async input => { assert.equal(String(input), '/api/rainforecast'); calls++; return answer; };
  const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container, recoveryRootOptions);
  function View() { state = useRainFeed(); forecast = useRainForecast(); return <p>{state.status}:{forecast?.areas[0].forecast}</p>; }
  try {
    await act(async () => { root.render(<View />); await settleDom(); }); assert.equal(calls, 1);
    await act(async () => { void state.refresh(); window.dispatchEvent(new Event('trafficpulse:refresh')); }); assert.equal(calls, 1);
    await act(async () => { first.resolve(Response.json(rainPayload())); await settleDom(); });
    assert.equal(state.status, 'live'); assert.equal(forecast, state.data); assert.match(dom.container.textContent!, /Heavy Rain/);
    const received = state.data, fetchedAt = state.fetchedAt;
    assert.equal(timers.timers.size, 1); assert.ok([...timers.timers.values()][0].ms <= config.poll.rain);
    answer = Promise.resolve(new Response('synthetic-private-provider-error', { status: 503 }));
    await act(async () => { await state.refresh(); }); assert.equal(state.status, 'error'); assert.equal(state.data, received); assert.equal(state.fetchedAt, fetchedAt);
    assert.ok(!dom.container.textContent!.includes('synthetic-private-provider-error'));
    answer = Promise.resolve(Response.json(rainPayload('Fair'), { headers: { 'X-TrafficPulse-Offline': '1', 'X-TrafficPulse-Cached-At': '1000' } }));
    await act(async () => { await state.refresh(); }); assert.equal(state.status, 'error'); assert.equal(state.data, received); assert.equal(state.fetchedAt, fetchedAt);
    answer = Promise.resolve(Response.json({ invalid: true }));
    await act(async () => { await state.refresh(); }); assert.equal(state.data, received); assert.equal(state.status, 'error');
    answer = Promise.resolve(Response.json(rainPayload('Fair')));
    await act(async () => { window.dispatchEvent(new Event('trafficpulse:refresh')); await settleDom(); }); assert.equal(state.status, 'live'); assert.equal(forecast!.areas[0].forecast, 'Fair');
    await act(async () => { root.unmount(); }); assert.equal(timers.timers.size, 0);
    const stopped = calls; window.dispatchEvent(new Event('trafficpulse:refresh')); await settleDom(); assert.equal(calls, stopped);
  } finally { await act(async () => { root.unmount(); }); globalThis.fetch = originalFetch; timers.restore(); dom.restore(); }
});

test('weather alert hook distinguishes initial outage, partial observations, full recovery and offline copies', async () => {
  const dom = installDom(), timers = manualTimers(), originalFetch = globalThis.fetch;
  let answer = () => new Response('', { status: 503 }), calls = 0, state!: ReturnType<typeof useWeatherAlerts>;
  globalThis.fetch = async input => { assert.equal(String(input), '/api/live?feed=weatheralerts'); calls++; return answer(); };
  const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container, recoveryRootOptions);
  function View() { state = useWeatherAlerts(); return <p>{state.status}</p>; }
  try {
    await act(async () => { root.render(<View />); await settleDom(); }); assert.equal(state.status, 'loading'); assert.equal(state.data, null);
    await act(async () => { await state.refresh(); }); assert.equal(state.status, 'error'); assert.equal(state.data, null);
    answer = () => Response.json({ strikes: [], heatStations: null, lightningAt: '2026-10-29T09:00:00+08:00', heatAt: null });
    await act(async () => { await state.refresh(); }); assert.equal(state.status, 'error'); assert.deepEqual(state.data!.strikes, []); assert.equal(state.data!.heatStations, null);
    answer = () => Response.json({ strikes: [], heatStations: [], lightningAt: null, heatAt: null });
    await act(async () => { await state.refresh(); }); assert.equal(state.status, 'live');
    const retained = state.data, at = state.fetchedAt;
    answer = () => Response.json({ strikes: [{ lat: 1.3, lon: 103.8 }], heatStations: [] }, { headers: { 'X-TrafficPulse-Offline': '1', 'X-TrafficPulse-Cached-At': '1000' } });
    await act(async () => { await state.refresh(); }); assert.equal(state.status, 'error'); assert.equal(state.data, retained); assert.equal(state.fetchedAt, at);
    answer = () => Response.json({ unexpected: true });
    await act(async () => { await state.refresh(); }); assert.equal(state.data, retained); assert.equal(state.status, 'error');
    await act(async () => { root.unmount(); }); assert.equal(timers.timers.size, 0);
    const stopped = calls; window.dispatchEvent(new Event('trafficpulse:refresh')); await settleDom(); assert.equal(calls, stopped);
  } finally { await act(async () => { root.unmount(); }); globalThis.fetch = originalFetch; timers.restore(); dom.restore(); }
});

test('browser queue defers optional work, promotes urgent delivery, falls back without idle support and logs safe failures', async () => {
  const dom = installDom(), timers = manualTimers(), before = console.warn, events: string[] = [];
  let idleId = 0, cancelled = 0; const idle = new Map<number, () => void>();
  window.requestIdleCallback = callback => { idle.set(++idleId, () => callback({ didTimeout: false, timeRemaining: () => 10 })); return idleId; };
  window.cancelIdleCallback = id => { idle.delete(id); cancelled++; };
  console.warn = value => { events.push(String(value)); };
  const queue = getBackgroundQueue(), order: string[] = [];
  const pump = async () => { const id = [...timers.timers].find(([, t]) => t.ms === 0)?.[0]; assert.ok(id); timers.fire(id); await settleDom(); };
  try {
    assert.equal(getBackgroundQueue(), queue); assert.notEqual(backgroundOwner('test'), backgroundOwner('test'));
    const optional = queue.enqueue({ lane: 'analysis', key: 'synthetic-photo', run: () => { order.push('analysis'); return 4; } });
    assert.equal(idle.size, 1); assert.equal(order.length, 0);
    const urgent = queue.enqueue({ lane: 'notifications', key: 'synthetic-alert', run: () => { order.push('notification'); return true; } });
    assert.equal(idle.size, 0); assert.equal(cancelled, 1); await pump();
    assert.deepEqual(order, ['notification', 'analysis']); assert.deepEqual(await urgent.result, { state: 'done', value: true }); assert.deepEqual(await optional.result, { state: 'done', value: 4 });
    Reflect.deleteProperty(window, 'requestIdleCallback'); Reflect.deleteProperty(window, 'cancelIdleCallback');
    const failure = queue.enqueue({ lane: 'history', key: 'synthetic-failure', run: () => { throw new Error('synthetic-private-job-error'); } });
    await pump(); assert.deepEqual(await failure.result, { state: 'failed' });
    assert.equal(JSON.parse(events[0]).code, 'JOB_FAILED'); assert.ok(!events.join('').includes('synthetic-private-job-error'));
    const pending = queue.enqueue({ lane: 'analysis', key: 'cancel-before-start', run: () => { assert.fail('disposed task must not execute'); } });
    queue.dispose(); assert.deepEqual(await pending.result, { state: 'cancelled' }); assert.equal(timers.timers.size, 0);
  } finally { queue.dispose(); console.warn = before; timers.restore(); dom.restore(); }
});
