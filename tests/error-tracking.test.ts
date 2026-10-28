import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { ERROR_TRACKING } from '../config/policy.ts';
import { config } from '../config/server.ts';
import { createConfig, createPublicConfig } from '../config/schema.ts';
import { captureException, exceptionDetails, installErrorTracking, newErrorId, validateBrowserReport, type BrowserErrorReport } from '../shared/errorTracking.ts';
import { reportApplicationFailure } from '../shared/applicationDiagnostics.ts';
import { withErrorContext } from '../server/observability/context.ts';
import { createBrowserErrorHandler } from '../server/observability/browserErrors.ts';
import { withRequestSchema } from '../server/http/validateRequest.ts';
import { requestSchemas } from '../server/http/requestSchemas.ts';
import { installBrowserErrorTracking } from '../src/features/app/browserErrorTracking.ts';
import live from '../api/live.ts';

const secret = 'synthetic-password-cookie-signed-url';
const hostile = () => Object.assign(new TypeError(secret), { stack: `TypeError: ${secret}\n    at work (https://private.invalid/${secret}?token=${secret}:12:34)`,
  cause: { password: secret }, toJSON() { throw new Error('Never serialize exceptions'); } });
const report = (): BrowserErrorReport => ({ version: 1, errorId: newErrorId(), scope: 'page', mechanism: 'react_boundary',
  page: 'cameras', release: 'a'.repeat(40), exceptionType: 'TypeError', locations: [{ line: 12, column: 34 }] });
const tick = () => new Promise(resolve => setImmediate(resolve));
async function logs<T>(run: (events: any[]) => Promise<T> | T) {
  const original = console.error, warn = console.warn, events: any[] = [];
  console.error = console.warn = value => events.push(JSON.parse(value));
  try { return await run(events); } finally { console.error = original; console.warn = warn; }
}
function nodeResponse() { return { statusCode: 0, body: undefined as any, headers: {} as Record<string, string>,
  setHeader(k: string, v: string) { this.headers[k.toLowerCase()] = v; }, status(n: number) { this.statusCode = n; return this; },
  json(body: any) { this.body = body; return this; } }; }
function request(body: unknown = report(), headers: Record<string, string> = {}, search = '?feed=errors') {
  return new Request('https://fixture.test/api/live' + search, { method: 'POST',
    headers: { Origin: config.siteUrl, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

test('exception projection records type/coordinates and correlated safe messages without raw exception/context fields', async () => {
  await logs(events => {
    const restore = installErrorTracking({ context: () => ({ route: secret, method: secret, requestId: secret, page: secret,
      release: secret, environment: secret, cookie: secret } as any) });
    try {
      const body = reportApplicationFailure('app', hostile(), 'react_boundary');
      assert.equal(body.error, 'Something went wrong. Please try again.');
      assert.equal(events[0].errorId, body.errorId);
      assert.equal(events[0].exceptionType, 'TypeError'); assert.deepEqual(events[0].locations, [{ line: 12, column: 34 }]);
      assert.equal(events[0].context.route, 'unknown'); assert.equal(events[0].context.release, 'unknown');
      assert.ok(!JSON.stringify([events, body]).includes(secret));
      assert.ok(!JSON.stringify(events).includes('private.invalid'));
      const getter = new Error(); let reads = 0;
      Object.defineProperty(getter, 'name', { get: () => ++reads === 1 ? 'TypeError' : secret });
      Object.defineProperty(getter, 'stack', { value: 'safe' });
      assert.equal(exceptionDetails(getter).exceptionType, 'TypeError'); assert.equal(reads, 1);
      Object.defineProperty(getter, 'message', { get() { throw new Error(secret); } });
      assert.doesNotThrow(() => captureException({ event: secret, code: secret }, getter));
      assert.ok(!JSON.stringify(events).includes(secret));
    } finally { restore(); }
  });
});

test('request contexts survive awaits, stay isolated concurrently and preserve nested dispatch identity', async () => {
  await logs(async events => {
    const ids = await Promise.all(['traffic', 'vms'].map(async route => {
      const req = new Request(`https://fixture.test/api/${route}?private=${secret}`, { headers: { 'x-request-id': secret, Cookie: secret } });
      return withErrorContext(req, async () => {
        await tick();
        const first = reportApplicationFailure('api', hostile());
        return withErrorContext(req, () => ({ first, second: reportApplicationFailure('api', hostile()) }));
      });
    }));
    assert.equal(events.length, 4);
    for (const route of ['traffic', 'vms']) {
      const group = events.filter(event => event.context.route === route);
      assert.equal(group.length, 2); assert.equal(group[0].context.requestId, group[1].context.requestId);
    }
    assert.notEqual(events.find(e => e.context.route === 'traffic').context.requestId, events.find(e => e.context.route === 'vms').context.requestId);
    assert.ok(ids.every(pair => events.some(e => e.errorId === pair.first.errorId)));
    assert.ok(!JSON.stringify(events).includes(secret));
  });
});

test('logging and telemetry sink failures cannot break safe API recovery', async () => {
  const original = console.error;
  const restore = installErrorTracking({ context() { throw hostile(); }, transport() { throw hostile(); } });
  console.error = () => { throw hostile(); };
  try {
    const handler = withRequestSchema(requestSchemas.empty, async () => { throw hostile(); });
    const response = await handler(new Request('https://fixture.test/api/traffic')) as Response;
    assert.equal(response.status, 500); assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json(); assert.equal(body.code, 'INTERNAL_ERROR'); assert.match(body.errorId, /^[a-f0-9-]{36}$/);
    assert.ok(!JSON.stringify(body).includes(secret));
  } finally { console.error = original; restore(); }
});

test('browser ingestion schema accepts only its versioned fixed vocabulary and bounded numeric locations', () => {
  assert.ok(validateBrowserReport(report()));
  for (const patch of [{ version: 2 }, { errorId: secret }, { scope: 'api' }, { mechanism: secret }, { page: secret }, { release: secret },
    { exceptionType: secret }, { locations: Array(4).fill({ line: 1, column: 1 }) }, { locations: [{ line: -1, column: 0 }] },
    { locations: [{ line: 1.5, column: 0 }] }, { locations: [{ line: 1, column: 1, path: secret }] }, { message: secret }, { stack: secret }, { user: secret }])
    assert.equal(validateBrowserReport({ ...report(), ...patch }), null);
});

for (const node of [false, true]) {
  test(`actual live ${node ? 'Node' : 'Web'} dispatcher centralizes accepted browser reports without storing headers or credentials`, async () => {
    await logs(async events => {
      const payload = report(), req = request(payload, { Cookie: secret, Authorization: secret });
      const res = node ? nodeResponse() : undefined;
      const response = await live(req, res) as Response;
      const body = res ? res.body : await response.json();
      assert.equal(res ? res.statusCode : response.status, 202); assert.equal(body.errorId, payload.errorId);
      const headers = res ? res.headers : Object.fromEntries(response.headers);
      assert.equal(headers['cache-control'], 'no-store'); assert.equal(headers['vercel-cdn-cache-control'], 'no-store');
      assert.equal(events.length, 1); assert.equal(events[0].event, 'client_exception');
      assert.equal(events[0].context.route, 'errors'); assert.equal(events[0].clientRelease, payload.release);
      assert.notEqual(events[0].context.requestId, payload.errorId); assert.ok(!JSON.stringify(events).includes(secret));
    });
  });
}

test('invalid telemetry never reaches admission or log emission; Node query/header ambiguity is rejected', async () => {
  let admitted = 0, captured = 0;
  const handler = createBrowserErrorHandler({ admit: { async run(_req, run) { admitted++; return run(); } }, capture() { captured++; } });
  const invalid = [request({ ...report(), message: secret }), request(report(), {}, '?feed=errors&limit=1'),
    request(report(), {}, '?feed=errors&feed=errors'), request(report(), { Origin: 'null' }), request(report(), { Origin: 'https://evil.invalid' }),
    request(report(), { 'Sec-Fetch-Site': 'cross-site' }), request(report(), { 'Content-Encoding': 'gzip' }),
    request(report(), { 'Content-Type': 'text/plain' }), request(report(), { 'Content-Length': '2049' })];
  const absent = request(); absent.headers.delete('Origin'); invalid.push(absent);
  for (const req of invalid) assert.ok((await handler(req) as Response).status >= 400);
  for (const req of [
    { url: '/api/live?feed=errors', query: { feed: ['errors'] } },
    { url: '/api/live?feed=errors', query: { feed: 'carparks' } },
    { url: '/api/live?feed=errors', headers: { origin: config.siteUrl, 'content-type': 'application/json' }, rawHeaders: ['Content-Type', 'text/plain'] },
  ]) {
    const response = await handler({ method: 'POST', body: report(), ...req }) as Response;
    assert.equal(response.status, 400);
  }
  const get = await handler(new Request('https://fixture.test/api/live?feed=errors')) as Response;
  assert.equal(get.status, 405); assert.equal(get.headers.get('allow'), 'POST');
  assert.equal(admitted, 0); assert.equal(captured, 0);
});

test('undeclared Web/Node body oversize and stalled reads are bounded before event capture', async () => {
  let captured = 0, cancelled = false;
  const handler = createBrowserErrorHandler({ capture() { captured++; } });
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(2049))); }, cancel() { cancelled = true; } });
  const req = new Request('https://fixture.test/api/live?feed=errors', { method: 'POST', headers: { Origin: config.siteUrl, 'Content-Type': 'application/json' }, body: stream, duplex: 'half' } as any);
  assert.equal((await handler(req) as Response).status, 413); assert.equal(cancelled, true);
  const node = Object.assign(Readable.from([Buffer.alloc(2049)]), { method: 'POST', url: '/api/live?feed=errors', headers: { origin: config.siteUrl, 'content-type': 'application/json' } });
  assert.equal((await handler(node) as Response).status, 413);
  const stalled = new Request('https://fixture.test/api/live?feed=errors', { method: 'POST', headers: { Origin: config.siteUrl, 'Content-Type': 'application/json' },
    body: new ReadableStream({ cancel() { cancelled = true; } }), duplex: 'half' } as any);
  cancelled = false; assert.equal((await handler(stalled) as Response).status, 408); assert.equal(cancelled, true);
  assert.equal(captured, 0);
});

test('browser event log budget is atomic per warm instance, recovers next window, and preserves platform denial', async () => {
  let now = 100000, captured = 0;
  const handler = createBrowserErrorHandler({ now: () => now, capture() { captured++; } });
  const responses = await Promise.all(Array.from({ length: ERROR_TRACKING.instanceBudget + 1 }, () => handler(request()) as Promise<Response>));
  assert.equal(responses.filter(r => r.status === 202).length, ERROR_TRACKING.instanceBudget);
  const rejected = responses.find(r => r.status === 429)!; assert.equal(rejected.headers.get('retry-after'), '60');
  now += ERROR_TRACKING.windowMs; assert.equal((await handler(request()) as Response).status, 202);
  assert.equal(captured, ERROR_TRACKING.instanceBudget + 1);
  const { RateLimitRejection } = await import('../server/http/rateLimit.ts');
  const blocked = createBrowserErrorHandler({ admit: { async run() { throw new RateLimitRejection(429); } }, capture() { captured++; } });
  assert.equal((await blocked(request()) as Response).status, 429); assert.equal(captured, ERROR_TRACKING.instanceBudget + 1);
});

function browser() {
  const target = new EventTarget(); Object.defineProperty(target, 'location', { value: { search: '?page=radar&token=' + secret } });
  const dispatch = (type: 'error' | 'unhandledrejection', value: unknown) => {
    const event = new Event(type, { cancelable: true }); Object.defineProperty(event, type === 'error' ? 'error' : 'reason', { value });
    target.dispatchEvent(event); return event;
  };
  return { target: target as unknown as Window, dispatch };
}

test('browser errors/rejections reach sanitized credential-free transport with deduplication, budgets and cleanup', async () => {
  await logs(async events => {
    const b = browser(), requests: RequestInit[] = [], notices: string[] = []; let now = 100000;
    const dispose = installBrowserErrorTracking(b.target, { now: () => now, notice: id => notices.push(id), fetch: async (url, init) => {
      assert.equal(url, '/api/live?feed=errors'); requests.push(init!); return Response.json({}, { status: 202 });
    } });
    try {
      assert.equal(b.dispatch('error', hostile()).defaultPrevented, true);
      b.dispatch('error', hostile()); b.dispatch('unhandledrejection', hostile()); await tick();
      // Fingerprints group equivalent exceptions across browser mechanisms; two events stay local, one POST.
      assert.equal(events.length, 3); assert.equal(requests.length, 1); assert.equal(notices.length, 1);
      assert.ok(events.every(event => event.errorId === events[0].errorId), 'deduplicated UI references must match the submitted report');
      const init = requests[0], value = JSON.parse(String(init.body));
      assert.ok(validateBrowserReport(value)); assert.equal(value.page, 'radar');
      assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error'); assert.equal(init.referrerPolicy, 'no-referrer');
      assert.ok(init.signal instanceof AbortSignal); assert.ok(!JSON.stringify(value).includes(secret));
      for (let i = 0; i < 20; i++) b.dispatch('error', Object.assign(hostile(), { stack: `TypeError\n at file:${100 + i}:2` }));
      await tick(); assert.equal(requests.length, ERROR_TRACKING.browserBudget);
      now += ERROR_TRACKING.windowMs; b.dispatch('error', hostile()); await tick(); assert.equal(requests.length, ERROR_TRACKING.browserBudget + 1);
    } finally { dispose(); }
    const before = events.length; b.dispatch('error', hostile()); await tick(); assert.equal(events.length, before);
  });
});

test('failed browser reporting never retries or creates unhandled rejections or nested diagnostics', async () => {
  await logs(async events => {
    const b = browser(); let calls = 0;
    const dispose = installBrowserErrorTracking(b.target, { fetch: async () => { calls++; throw hostile(); } });
    try { b.dispatch('unhandledrejection', hostile()); await tick(); await tick(); assert.equal(calls, 1); assert.equal(events.length, 1); }
    finally { dispose(); }
  });
});

test('release metadata is safely projected from platform metadata without copying secrets or arbitrary labels', () => {
  const sha = 'a'.repeat(40);
  assert.deepEqual(createConfig({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_SHA: sha }).errorTracking, { release: sha, environment: 'preview' });
  assert.deepEqual(createPublicConfig({ VITE_VERCEL_ENV: 'production', VITE_VERCEL_GIT_COMMIT_SHA: sha }).errorTracking, { release: sha, environment: 'production' });
  assert.equal(createConfig({ VERCEL_GIT_COMMIT_SHA: secret }).errorTracking.release, 'unknown');
  assert.ok(!JSON.stringify(createPublicConfig({ VITE_VERCEL_GIT_COMMIT_SHA: secret })).includes(secret));
});
