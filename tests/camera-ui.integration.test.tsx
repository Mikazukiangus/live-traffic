import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { installDom, deferred, settleDom } from './helpers/dom.ts';
import { useCameraFeed } from '../src/features/cameras/useCameraFeed.ts';
import { useCameraNavigation } from '../src/features/cameras/useCameraNavigation.ts';
import { useAppNavigation } from '../src/features/app/useAppNavigation.ts';
import { normalizeCameraFeed } from '../src/features/cameras/normalizeCameraFeed.ts';
import { CameraImage } from '../src/features/cameras/CameraImage.tsx';
import { CameraTile } from '../src/features/cameras/CameraTile.tsx';
import { ErrorBoundary } from '../src/components/ErrorBoundary.tsx';
import { recoveryRootOptions } from '../src/features/app/errorReporting.ts';
import { config } from '../config/client.ts';

const capture = '2026-10-29T01:00:00Z';
function payload(id = '2701') { return { success: true, totalCameras: 1, source: 'lta_datamall_v2', timestamp: capture,
  cameras: [{ camera_id: id, image: `https://images.data.gov.sg/${id}.jpg?signature=synthetic-only`, timestamp: capture, latitude: 1.44, longitude: 103.77 }] }; }
const cameras = normalizeCameraFeed([payload().cameras[0], { ...payload('4703').cameras[0], latitude: 1.35, longitude: 103.64 }], capture);

test('app opens on cameras, clears nested selection when switching pages, and follows history without reloading', async () => {
  const dom = installDom('https://fixture.test/?tab=signs&cam=2701&incident=old');
  dom.window.scrollTo = () => {};
  const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container, recoveryRootOptions);
  let state!: ReturnType<typeof useAppNavigation>;
  function View() { state = useAppNavigation(); return <p>{state.activeTab}</p>; }
  try {
    await act(async () => { root.render(<View />); });
    assert.equal(state.activeTab, 'highway-cameras-emas'); assert.equal(new URL(window.location.href).searchParams.get('page'), 'cameras');
    await act(async () => { state.setActiveTab('live-traffic-radar'); });
    assert.equal(state.activeTab, 'live-traffic-radar');
    assert.equal(window.location.search, '?page=radar');
    await act(async () => { window.history.replaceState(null, '', '?page=courier'); window.dispatchEvent(new window.PopStateEvent('popstate')); });
    assert.equal(state.activeTab, 'route-alerts-courier-hub');
    await act(async () => { window.dispatchEvent(new window.KeyboardEvent('keydown', { key: '?' })); }); assert.equal(state.shortcutsOpen, true);
    await act(async () => { window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' })); }); assert.equal(state.shortcutsOpen, false);
    await act(async () => { root.unmount(); }); const url = window.location.href;
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'c' })); assert.equal(window.location.href, url);
  } finally { await act(async () => { root.unmount(); }); dom.restore(); }
});

test('camera hook coalesces refresh triggers, preserves last good data on failure, and cleans up polling', async () => {
  const dom = installDom(), previousFetch = globalThis.fetch, interval = globalThis.setInterval, clear = globalThis.clearInterval;
  const timers = new Set<() => void>(); let calls = 0, current!: ReturnType<typeof useCameraFeed>;
  const first = deferred<Response>(); let response = first.promise;
  globalThis.fetch = async () => { calls++; return response; };
  globalThis.setInterval = ((callback: () => void) => { timers.add(callback); return callback as any; }) as any;
  globalThis.clearInterval = ((callback: any) => timers.delete(callback)) as any;
  const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container, recoveryRootOptions);
  function View() { current = useCameraFeed(); return <p>{current.feedFailed ? 'Delayed' : 'Current'}:{current.cameras.length}</p>; }
  try {
    await act(async () => { root.render(<View />); }); assert.equal(calls, 1); assert.equal(timers.size, 1);
    await act(async () => { current.refresh(); window.dispatchEvent(new Event('trafficpulse:refresh')); }); assert.equal(calls, 1);
    await act(async () => { first.resolve(Response.json(payload())); await settleDom(); });
    assert.equal(current.cameras[0].id, 'lta-live-2701'); assert.equal(current.refreshing, false); assert.equal(current.feedFailed, false);
    const received = current.cameras;
    response = Promise.resolve(new Response('', { status: 503 }));
    await act(async () => { await current.refresh(); });
    assert.equal(current.feedFailed, true); assert.equal(current.cameras, received); assert.equal(current.latestCapture, capture);
    response = Promise.resolve(Response.json(payload()));
    await act(async () => { window.dispatchEvent(new Event('trafficpulse:refresh')); await settleDom(); });
    assert.equal(current.feedFailed, false);
    await act(async () => { root.unmount(); }); assert.equal(timers.size, 0);
    const done = calls; window.dispatchEvent(new Event('trafficpulse:refresh')); await settleDom(); assert.equal(calls, done);
  } finally { await act(async () => { root.unmount(); }); globalThis.fetch = previousFetch; globalThis.setInterval = interval; globalThis.clearInterval = clear; dom.restore(); }
});

test('camera hook marks cached offline answers and ignores completion after unmount', async () => {
  const dom = installDom(), original = globalThis.fetch;
  const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container, recoveryRootOptions);
  let current!: ReturnType<typeof useCameraFeed>, renders = 0;
  const late = deferred<Response>(); let answer = Promise.resolve(Response.json(payload(), { headers: { 'X-TrafficPulse-Offline': '1' } }));
  globalThis.fetch = async () => answer;
  function View() { current = useCameraFeed(); renders++; return <p>{current.cameras.length}</p>; }
  try {
    await act(async () => { root.render(<View />); await settleDom(); }); assert.equal(current.feedFailed, true); assert.equal(current.latestCapture, capture);
    answer = late.promise; let refreshing!: Promise<void>;
    await act(async () => { refreshing = current.refresh(); });
    await act(async () => { root.unmount(); }); const before = renders;
    late.resolve(Response.json(payload('4703'))); await refreshing; await settleDom(); assert.equal(renders, before);
  } finally { await act(async () => { root.unmount(); }); globalThis.fetch = original; dom.restore(); }
});

test('camera tabs and shared camera links update in place, keyboard ignores typing, and listeners detach', async () => {
  const dom = installDom('https://fixture.test/?page=cameras&tab=tuas&cam=4703');
  const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container, recoveryRootOptions);
  let state!: ReturnType<typeof useCameraNavigation>;
  function View() { state = useCameraNavigation(cameras, false); return <><p>{state.shownTab}</p><input aria-label="Search" /></>; }
  try {
    await act(async () => { root.render(<View />); }); assert.equal(state.shownTab, 'tuas'); assert.equal(state.selectedCam?.id, 'lta-live-4703');
    await act(async () => { state.selectTab('woodlands'); }); assert.equal(state.shownTab, 'woodlands'); assert.equal(window.location.pathname, '/');
    await act(async () => { dom.document.querySelector('input')!.dispatchEvent(new window.KeyboardEvent('keydown', { key: '3', bubbles: true })); });
    assert.equal(state.shownTab, 'woodlands');
    await act(async () => { window.dispatchEvent(new window.KeyboardEvent('keydown', { key: '3', bubbles: true })); }); assert.equal(state.shownTab, 'signs');
    await act(async () => { state.toggleGridCam('2701'); }); assert.deepEqual(state.gridCams.map(c => c.id), ['lta-live-4703']);
    await act(async () => { root.unmount(); }); const url = window.location.href;
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: '1' })); assert.equal(window.location.href, url);
  } finally { await act(async () => { root.unmount(); }); dom.restore(); }
});

test('image failure is hidden and a new capture gets a fresh image; stale cards retain delayed labels', async () => {
  const dom = installDom(); const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container, recoveryRootOptions);
  try {
    await act(async () => { root.render(<CameraImage imageUrl={cameras[0].imageUrl} alt="Checkpoint" />); });
    const old = dom.document.querySelector('img')!; assert.match(old.src, /\/api\/imageproxy\?url=/); assert.equal(old.getAttribute('referrerpolicy'), 'no-referrer');
    await act(async () => { old.dispatchEvent(new window.Event('error')); }); assert.equal(old.style.visibility, 'hidden');
    await act(async () => { root.render(<CameraImage imageUrl="https://images.data.gov.sg/new.jpg" alt="Checkpoint" />); });
    assert.notEqual(dom.document.querySelector('img'), old); assert.equal(dom.document.querySelector('img')!.style.visibility, '');
    let opened = '';
    for (const compact of [false, true]) {
      await act(async () => { root.render(<CameraTile cam={cameras[0]} now={Date.parse(capture) + config.freshness.cameras + 1} reading={null} compact={compact} openCam={cam => { opened = cam.id; }} />); });
      assert.match(dom.container.textContent!, /Delayed/);
      await act(async () => { dom.document.querySelector('button')!.click(); }); assert.equal(opened, cameras[0].id);
    }
  } finally { await act(async () => { root.unmount(); }); dom.restore(); }
});

test('real React boundary shows safe text and matching diagnostic reference, permits one retry and resets by navigation', async () => {
  const dom = installDom(), previous = console.error, entries: any[] = [];
  console.error = value => { entries.push(JSON.parse(value)); };
  const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container, recoveryRootOptions);
  const marker = 'synthetic-private-error-text';
  function Broken(): React.ReactNode { throw new TypeError(marker); }
  try {
    await act(async () => { root.render(<ErrorBoundary key="cameras" scope="page"><Broken /></ErrorBoundary>); });
    assert.match(dom.container.textContent!, /This view couldn’t load/); assert.ok(!dom.container.textContent!.includes(marker));
    assert.ok(dom.container.textContent!.includes(entries[0].errorId));
    await act(async () => { [...dom.document.querySelectorAll('button')].find(b => b.textContent === 'Try again')!.click(); });
    assert.equal([...dom.document.querySelectorAll('button')].some(b => b.textContent === 'Try again'), false);
    assert.equal(entries.length, 2); assert.ok(!JSON.stringify(entries).includes(marker));
    await act(async () => { root.render(<ErrorBoundary key="radar" scope="page"><p>Recovered view</p></ErrorBoundary>); });
    assert.equal(dom.container.textContent, 'Recovered view');
  } finally { await act(async () => { root.unmount(); }); console.error = previous; dom.restore(); }
});
