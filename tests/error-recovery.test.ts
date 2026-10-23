import { recoveryRootOptions } from '../src/features/app/errorReporting.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withRequestSchema } from '../server/http/validateRequest.ts';
import { requestSchemas } from '../server/http/requestSchemas.ts';
import { CircuitOpenError, InvalidPayloadError, UpstreamHttpError } from '../shared/diagnostics.ts';
import { reportApplicationFailure, reportNotificationFailure } from '../shared/applicationDiagnostics.ts';
import { config } from '../config/server.ts';
import airquality from '../api/airquality.ts';
import { requestCommuteNotifications, sendCommuteNotification, type NotificationPort } from '../src/features/commutes/notificationDelivery.ts';
import { createCommuteAlertQueue, type AlertCandidate } from '../src/features/commutes/commuteAlertQueue.ts';

const marker = 'synthetic-private-marker';
const hostile = () => Object.assign(new Error(marker), { stack: marker, cause: marker, toJSON() { throw new Error('do not serialize'); } });
async function capture(run: (logs: string[]) => Promise<void>) {
  const error = console.error, warn = console.warn, logs: string[] = [];
  console.error = console.warn = (...args) => { logs.push(JSON.stringify(args)); };
  try { await run(logs); } finally { console.error = error; console.warn = warn; }
}
function nodeResponse() {
  return { headers: {} as Record<string, string>, statusCode: 0, body: undefined as any,
    setHeader(name: string, value: string) { this.headers[name.toLowerCase()] = value; },
    getHeader(name: string) { return this.headers[name.toLowerCase()]; },
    removeHeader(name: string) { delete this.headers[name.toLowerCase()]; },
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
}

for (const mode of ['web', 'node'] as const) {
  test(`${mode} outer boundary sanitizes unexpected sync/async/serialization failures and keeps CORS/no-store`, async () => {
    await capture(async logs => {
      for (const kind of ['sync', 'async', 'serialization']) {
        const handler = withRequestSchema(requestSchemas.empty, async (_req, res) => {
          if (res) {
            res.setHeader('Cache-Control', 'public, max-age=600');
            res.setHeader('Vercel-CDN-Cache-Control', 'max-age=600');
            res.setHeader('Content-Length', '999'); res.setHeader('Retry-After', '999');
          }
          if (kind === 'serialization') return new Response(JSON.stringify({ toJSON() { throw hostile(); } }));
          if (kind === 'async') await Promise.resolve();
          throw hostile();
        });
        const res = mode === 'node' ? nodeResponse() : undefined;
        const response = await handler(new Request('https://example.test/api/test', { headers: { Origin: config.siteUrl } }), res);
        const body = res ? res.body : await response.json();
        const headers = res ? res.headers : Object.fromEntries(response.headers);
        assert.equal(res ? res.statusCode : response.status, 500);
        assert.equal(body.code, 'INTERNAL_ERROR');
        assert.equal(headers['cache-control'], 'no-store');
        assert.equal(headers['vercel-cdn-cache-control'], 'no-store');
        assert.equal(headers['access-control-allow-origin'], config.siteUrl);
        assert.match(headers.vary, /Origin/);
        assert.ok(!('content-length' in headers)); assert.ok(!('retry-after' in headers));
        assert.ok(!JSON.stringify([body, logs]).includes(marker));
      }
      assert.equal(logs.length, 3);
    });
  });
}

test('outer boundary preserves typed provider/circuit errors while committed responses are never written twice', async () => {
  await capture(async logs => {
    for (const [error, status, code] of [[new InvalidPayloadError(), 502, 'UPSTREAM_INVALID_RESPONSE'],
      [new UpstreamHttpError(429), 429, 'UPSTREAM_HTTP_ERROR'], [new CircuitOpenError(Date.now() + 30000), 503, 'UPSTREAM_CIRCUIT_OPEN']] as const) {
      const handler = withRequestSchema(requestSchemas.empty, async () => { throw error; });
      const response = await handler(new Request('https://example.test/api/test'));
      assert.equal(response.status, status); assert.equal((await response.json()).code, code);
      if (error instanceof CircuitOpenError) assert.ok(Number(response.headers.get('Retry-After')) > 0);
    }
    let writes = 0, destroyed = 0;
    const handler = withRequestSchema(requestSchemas.empty, async () => { throw hostile(); });
    const res = { headersSent: true, writableEnded: false, setHeader() { writes++; }, destroy() { destroyed++; } };
    await handler(new Request('https://example.test/api/test'), res);
    // Initial CORS decoration occurs before the handler; the catch cannot write after it fails.
    assert.equal(writes, 1); assert.equal(destroyed, 1);
    await handler(new Request('https://example.test/api/test'), { ...res, writableEnded: true });
    assert.equal(destroyed, 1);
    assert.ok(!JSON.stringify(logs).includes(marker));
  });
});

test('malformed successful air data now becomes a safe invalid-provider response rather than escaping as TypeError', async () => {
  const original = globalThis.fetch;
  await capture(async logs => {
    globalThis.fetch = async () => Response.json({ code: 0, data: { regionMetadata: { private: marker }, items: [{ readings: {} }] } });
    try {
      for (const res of [undefined, nodeResponse()]) {
        const response = await airquality(new Request('https://example.test/api/airquality'), res) as Response;
        const body = res ? res.body : await response.json();
        assert.equal(res ? res.statusCode : response.status, 502);
        assert.equal(body.code, 'UPSTREAM_INVALID_RESPONSE');
        assert.ok(!JSON.stringify([body, logs]).includes(marker));
      }
    } finally { globalThis.fetch = original; }
  });
});

function port(overrides: Partial<NotificationPort> = {}): NotificationPort {
  return { supported: () => true, permission: () => 'granted', requestPermission: async () => 'granted',
    worker: async () => undefined, show() {}, ...overrides };
}

test('notification permission resolves distinct outcomes without leaking rejected values or prompting again after denial', async () => {
  await capture(async logs => {
    assert.equal(await requestCommuteNotifications(port({ supported: () => false })), 'unsupported');
    for (const permission of ['granted', 'denied', 'default'] as const)
      assert.equal(await requestCommuteNotifications(port({ permission: () => 'default', requestPermission: async () => permission })), permission === 'default' ? 'dismissed' : permission);
    assert.equal(await requestCommuteNotifications(port({ permission: () => 'denied', requestPermission: async () => { throw hostile(); } })), 'denied');
    assert.equal(await requestCommuteNotifications(port({ permission: () => 'default', requestPermission: async () => { throw hostile(); } })), 'failed');
    assert.equal(logs.length, 1); assert.ok(!logs.join().includes(marker));
  });
});

test('worker notifications, safe desktop fallback and unsupported mobile constructor failures always resolve', async () => {
  await capture(async logs => {
    let shown = 0;
    const accepted = port({ worker: async () => ({ showNotification: async (_title, options) => {
      assert.equal(options?.data.url, '/?page=radar&tab=incidents');
    } }), show() { throw new Error('fallback should not run'); } });
    assert.equal(await sendCommuteNotification(marker, marker, accepted), 'sent');
    const fallback = port({ worker: async () => { throw hostile(); }, show() { shown++; } });
    assert.equal(await sendCommuteNotification(marker, marker, fallback), 'sent'); assert.equal(shown, 1);
    assert.equal(await sendCommuteNotification(marker, marker, port({ worker: async () => ({ showNotification: async () => { throw hostile(); } }), show() { throw hostile(); } })), 'failed');
    assert.equal(await sendCommuteNotification(marker, marker, port({ supported: () => false })), 'unsupported');
    assert.equal(await sendCommuteNotification(marker, marker, port({ permission: () => 'denied' })), 'blocked');
    assert.equal(logs.length, 1); assert.ok(!logs.join().includes(marker));
  });
});

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const candidate = (key: string): AlertCandidate => ({ key, title: marker, body: marker });
function queueHarness() {
  let now = 100000, calls = 0;
  const timers = new Set<{ run: () => void; at: number }>(), notices: (string | null)[] = [];
  let send = async (): Promise<'sent' | 'failed' | 'blocked'> => 'sent';
  const queue = createCommuteAlertQueue({ now: () => now, onNotice: notice => notices.push(notice),
    send: async () => { calls++; return send(); }, schedule: (run, ms) => {
      const task = { run, at: now + ms }; timers.add(task); return () => { timers.delete(task); };
    } });
  return { queue, timers, notices, calls: () => calls, send: (fn: typeof send) => { send = fn; },
    advance: (ms: number) => { now += ms; for (const task of [...timers]) if (task.at <= now) { timers.delete(task); task.run(); } } };
}

test('alert baseline, in-flight coalescing and successful receipts prevent duplicate delivery', async () => {
  const h = queueHarness();
  h.queue.observe([], [], false); // An initial failure must not establish a baseline.
  h.queue.observe(['old'], [candidate('old')]);
  assert.equal(h.calls(), 0);
  let finish!: () => void;
  h.send(() => new Promise(resolve => { finish = () => resolve('sent'); }));
  h.queue.observe(['old', 'new'], [candidate('old'), candidate('new')]);
  h.queue.observe(['old', 'new'], [candidate('new')]);
  assert.equal(h.calls(), 1);
  finish(); await tick();
  h.queue.observe(['new'], [candidate('new')]);
  assert.equal(h.calls(), 1); assert.equal(h.notices.at(-1), null); h.queue.dispose();
});

test('failed alerts remain retryable, retries stop at three and terminal failures are visible without renewing attempts', async () => {
  const h = queueHarness(); h.queue.observe([], []); h.send(async () => 'failed');
  h.queue.observe(['new'], [candidate('new')]); await tick();
  assert.equal(h.calls(), 1); assert.match(h.notices.at(-1)!, /Retrying/);
  for (let i = 0; i < 2; i++) { h.advance(15000); await tick(); }
  assert.equal(h.calls(), 3); assert.equal(h.timers.size, 0); assert.match(h.notices.at(-1)!, /couldn’t be sent/);
  h.queue.observe(['new'], [candidate('new')]); h.advance(15000); await tick(); assert.equal(h.calls(), 3);
  const recovering = queueHarness(); recovering.queue.observe([], []); recovering.send(async () => 'failed');
  recovering.queue.observe(['new'], [candidate('new')]); await tick();
  recovering.send(async () => 'sent'); recovering.advance(15000); await tick();
  assert.equal(recovering.calls(), 2); assert.equal(recovering.notices.at(-1), null);
  recovering.queue.observe(['new'], [candidate('new')]); assert.equal(recovering.calls(), 2);
  h.queue.dispose(); recovering.queue.dispose();
});

test('removed/disabled/expired alerts and disposed queues cannot retry or publish late results', async () => {
  for (const reason of ['removed', 'disabled', 'expired', 'disposed']) {
    const h = queueHarness(); h.queue.observe([], []); h.send(async () => 'failed');
    h.queue.observe(['new'], [candidate('new')]); await tick();
    if (reason === 'removed') h.queue.observe([], []);
    if (reason === 'disabled') h.queue.observe(['new'], [], false); // Still cancel if the feed currently has an error.
    if (reason === 'expired') h.advance(120000);
    if (reason === 'disposed') h.queue.dispose();
    const notices = h.notices.length;
    h.advance(15000); await tick(); assert.equal(h.calls(), 1);
    if (reason === 'disposed') assert.equal(h.notices.length, notices);
    h.queue.dispose();
  }
  const h = queueHarness(); h.queue.observe([], []);
  let finish!: () => void;
  h.send(() => new Promise(resolve => { finish = () => resolve('failed'); }));
  h.queue.observe(['new'], [candidate('new')]); h.queue.dispose();
  const notices = h.notices.length; finish(); await tick();
  assert.equal(h.notices.length, notices); assert.equal(h.timers.size, 0);
});

test('permission revocation and unexpected send rejections are handled without permission retry loops or raw diagnostics', async () => {
  await capture(async logs => {
    const blocked = queueHarness(); blocked.queue.observe([], []); blocked.send(async () => 'blocked');
    blocked.queue.observe(['new'], [candidate('new')]); await tick();
    assert.equal(blocked.timers.size, 0); assert.match(blocked.notices.at(-1)!, /blocked/);
    const failed = queueHarness(); failed.queue.observe([], []); failed.send(async () => { throw hostile(); });
    failed.queue.observe(['new'], [candidate('new')]); await tick();
    assert.equal(failed.timers.size, 1); assert.ok(!JSON.stringify([failed.notices, logs]).includes(marker));
    blocked.queue.dispose(); failed.queue.dispose();
  });
});

test('application and notification diagnostic events accept only fixed classifications', async () => {
  await capture(async logs => {
    const body = reportApplicationFailure(marker as 'app'); reportNotificationFailure(marker as 'delivery');
    assert.equal(body.code, 'INTERNAL_ERROR'); assert.ok(!JSON.stringify([body, logs]).includes(marker));
  });
});


test('React root callbacks suppress default raw details and emit only fixed uncaught/recoverable classifications', async () => {
  await capture(async logs => {
    recoveryRootOptions.onCaughtError!(hostile(), { componentStack: marker, errorBoundary: undefined });
    assert.equal(logs.length, 0, 'the boundary owns the caught-error event');
    recoveryRootOptions.onUncaughtError!(hostile(), { componentStack: marker });
    recoveryRootOptions.onRecoverableError!(hostile(), { componentStack: marker });
    assert.equal(logs.length, 2);
    assert.ok(!logs.join().includes(marker));
  });
});
