import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { runInNewContext } from 'node:vm';
import { withRequestDeadline } from '../shared/requestDeadline.ts';
import { safeFailure } from '../shared/diagnostics.ts';
import { fetchWithTimeout, requestTimeoutMs } from '../src/utils/request.ts';
import { fetchFeed } from '../src/utils/feedResponse.ts';
import { fetchCameras } from '../src/features/cameras/cameraClient.ts';
import { loadImage } from '../src/features/vehicle-counting/loadImage.ts';
import { fetchProvider } from '../server/http/providerFetch.ts';
import { createPublicConfig } from '../config/schema.ts';
import { serviceWorkerSource, workerGlobals } from './helpers/serviceWorker.ts';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const isTimeout = (error: unknown) => error instanceof Error && error.name === 'TimeoutError';

test('deadlines abort stalled work, sanitize timeout diagnostics and release successful timers', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let stalledSignal!: AbortSignal;
  const stalled = withRequestDeadline(100, async (signal) => {
    stalledSignal = signal;
    return new Promise<never>(() => {});
  });
  const rejected = assert.rejects(stalled, isTimeout);
  await tick();
  t.mock.timers.tick(100);
  await rejected;
  assert.equal(stalledSignal.aborted, true);
  assert.equal(safeFailure('gateway', stalledSignal.reason).body.code, 'UPSTREAM_TIMEOUT');
  let successSignal!: AbortSignal;
  assert.equal(await withRequestDeadline(100, async (signal) => { successSignal = signal; return 7; }), 7);
  t.mock.timers.tick(1000);
  assert.equal(successSignal.aborted, false, 'successful operations clear their deadline');
});

test('caller cancellation is preserved, including pre-aborted requests that must never start', async () => {
  const parent = new AbortController();
  const reason = new DOMException('Cancelled', 'AbortError');
  let signal!: AbortSignal;
  const pending = withRequestDeadline(1000, async (next) => {
    signal = next;
    return new Promise<never>(() => {});
  }, parent.signal);
  const rejected = assert.rejects(pending, (error) => error === reason);
  await tick();
  parent.abort(reason);
  await rejected;
  assert.equal(signal.reason, reason);
  let started = false;
  await assert.rejects(withRequestDeadline(1000, async () => { started = true; }, parent.signal), (error) => error === reason);
  assert.equal(started, false);
});

test('native fetch is aborted when its response body stalls after successful headers', async () => {
  let sentHeaders = false;
  let connectionClosed!: () => void;
  const closed = new Promise<void>((resolve) => { connectionClosed = resolve; });
  const server = createServer((req, res) => {
    req.once('close', connectionClosed);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{"value":'); // Deliberately never finish the body.
    sentHeaders = true;
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    await assert.rejects(fetchWithTimeout(`http://127.0.0.1:${address.port}/fixture`, (response) => response.json(), {}, 200), isTimeout);
    assert.equal(sentHeaders, true, 'the timeout must include body reads, not only connection/header time');
    await closed;
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('timed-out shared feeds coalesce, release pending state and permit a successful refresh', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  let captured!: AbortSignal;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    calls++;
    captured = init.signal!;
    return new Promise<Response>(() => {});
  });
  const first = fetchFeed('/api/fixture-timeout');
  assert.equal(fetchFeed('/api/fixture-timeout'), first);
  const rejected = assert.rejects(first, isTimeout);
  await tick();
  t.mock.timers.tick(createPublicConfig().timeouts.request);
  await rejected;
  assert.equal(captured.aborted, true);
  assert.equal(calls, 1);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ value: [] }));
  assert.deepEqual((await fetchFeed('/api/fixture-timeout')).data, { value: [] });
});

test('browser camera metadata falls back to the public source when the primary stalls', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const signals: AbortSignal[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    signals.push(init.signal!);
    calls++;
    if (calls === 1) return new Promise<Response>(() => {});
    return Response.json({ items: [{ timestamp: '2026-10-22T08:00:00+08:00', cameras: [{
      camera_id: '2701', image: 'https://images.data.gov.sg/fixture.jpg', location: { latitude: 1.44, longitude: 103.77 },
    }] }] });
  });
  const pending = fetchCameras();
  await tick();
  t.mock.timers.tick(createPublicConfig().timeouts.request);
  const result = await pending;
  assert.equal(result.cameras.length, 1);
  assert.equal(calls, 2);
  assert.equal(signals[0].aborted, true);
  assert.equal(signals[1].aborted, false);
});

test('vehicle photo timeout removes the source/handlers, while successful loads clear their timer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let removed = false;
  const image = { onload: null, onerror: null, src: '', removeAttribute: (name: string) => { assert.equal(name, 'src'); removed = true; } } as unknown as HTMLImageElement;
  const pending = loadImage('https://images.data.gov.sg/fixture.jpg', 100, () => image);
  const rejected = assert.rejects(pending, isTimeout);
  await tick();
  t.mock.timers.tick(100);
  await rejected;
  assert.equal(removed, true);
  assert.equal(image.onload, null);
  assert.equal(image.onerror, null);
  removed = false;
  const successful = loadImage('/fixture.jpg', 100, () => image);
  await tick();
  image.onload!.call(image, new Event('load'));
  assert.equal(await successful, image);
  t.mock.timers.tick(100);
  assert.equal(removed, false);
});

test('public deadlines are validated/configurable and slow aggregation has its own budget', async () => {
  const config = createPublicConfig({ VITE_REQUEST_TIMEOUT_MS: '20000', VITE_SPEED_REQUEST_TIMEOUT_MS: '120000', VITE_ASSET_TIMEOUT_MS: '90000' });
  assert.deepEqual(config.timeouts, { request: 20000, speeds: 120000, assets: 90000 });
  for (const key of ['VITE_REQUEST_TIMEOUT_MS', 'VITE_SPEED_REQUEST_TIMEOUT_MS', 'VITE_ASSET_TIMEOUT_MS']) {
    for (const value of ['0', 'NaN', '900000']) assert.throws(() => createPublicConfig({ [key]: value }), new RegExp(key));
  }
  assert.equal(requestTimeoutMs('/api/expresswayspeeds?include=segments'), 90000);
  assert.equal(requestTimeoutMs('/api/traffic'), 30000);
  assert.equal(requestTimeoutMs('/api/health'), 30000);
  let signal!: AbortSignal;
  await fetchProvider('https://example.test/fixture', {}, (async (_url, init) => {
    signal = init!.signal!;
    return Response.json({});
  }) as typeof fetch);
  assert.ok(signal instanceof AbortSignal, 'server transport supplies an omitted default deadline');
});

async function workerHarness(fetcher: typeof fetch) {
  const saved = new Map<string, Response>();
  const handlers: Record<string, (event: any) => void> = {};
  const key = (r: Request | string) => typeof r === 'string' ? new URL(r, 'https://traffic.test').href : r.url;
  runInNewContext(await serviceWorkerSource({ request: 100, speeds: 200, assets: 300 }), {
    ...workerGlobals(), fetch: fetcher,
    self: { location: { origin: 'https://traffic.test' }, skipWaiting() {}, addEventListener: (name: string, fn: any) => { handlers[name] = fn; } },
    caches: { match: async (r: Request | string) => saved.get(key(r))?.clone(), open: async () => ({
      put: async (r: Request | string, response: Response) => { saved.set(key(r), response); }, keys: async () => [],
    }) },
  });
  return { saved, handlers, load: (path: string, signal?: AbortSignal) => {
    let pending!: Promise<Response>;
    handlers.fetch({ request: new Request(new URL(path, 'https://traffic.test'), { signal }), respondWith: (p: Promise<Response>) => { pending = p; } });
    return pending;
  } };
}

test('service worker timeout returns the last complete feed without renewing its receipt time', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let stalled = false;
  let captured!: AbortSignal;
  const h = await workerHarness((async (_url, init) => {
    captured = init!.signal!;
    if (stalled) return new Promise<Response>(() => {});
    return Response.json({ value: [] });
  }) as typeof fetch);
  await h.load('/api/traffic');
  const received = h.saved.get('https://traffic.test/api/traffic')!.headers.get('X-TrafficPulse-Cached-At');
  stalled = true;
  const pending = h.load('/api/traffic');
  await tick();
  t.mock.timers.tick(80);
  const fallback = await pending;
  assert.equal(captured.aborted, true);
  assert.equal(fallback.headers.get('X-TrafficPulse-Offline'), '1');
  assert.equal(fallback.headers.get('X-TrafficPulse-Cached-At'), received);
  assert.deepEqual(await fallback.json(), { value: [] });
});

test('worker covers stalled bodies, cold assets/fonts, installation and caller cancellation', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = await workerHarness((async (_url, init) => {
    const body = new ReadableStream({ start(controller) {
      init!.signal!.addEventListener('abort', () => controller.error(init!.signal!.reason), { once: true });
    } });
    return new Response(body);
  }) as typeof fetch);
  for (const [url, budget] of [['/api/expresswayspeeds?include=segments', 160], ['/assets/fixture.js', 300], ['https://fonts.gstatic.com/fixture.woff2', 100]] as const) {
    const pending = h.load(url);
    const rejected = assert.rejects(pending, (error: any) => error?.name === 'TimeoutError');
    await tick();
    t.mock.timers.tick(budget);
    await rejected;
  }
  let installed!: Promise<void>;
  h.handlers.install({ waitUntil: (promise: Promise<void>) => { installed = promise; } });
  const rejectedInstall = assert.rejects(installed, (error: any) => error?.name === 'TimeoutError');
  await tick();
  t.mock.timers.tick(300);
  await rejectedInstall;
  const parent = new AbortController();
  const pending = h.load('/api/traffic', parent.signal);
  const rejected = assert.rejects(pending, (error: any) => error?.name === 'AbortError');
  await tick();
  parent.abort();
  await rejected;
  assert.equal(h.saved.size, 0, 'partial/timed-out bodies must never replace complete cached data');
});
