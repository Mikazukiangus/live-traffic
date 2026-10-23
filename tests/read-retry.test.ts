import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProviderReader, ProviderReadError, providerRetryHeaders } from '../server/http/readProvider.ts';
import { waitForRetry } from '../shared/requestDeadline.ts';
import { readRetryDelay, safeReadRequest, transientReadError } from '../shared/readRetry.ts';
import { InvalidPayloadError, safeFailure } from '../shared/diagnostics.ts';
import { SsrfError } from '../server/http/ssrf.ts';
import { createDataGovClient } from '../server/providers/dataGovClient.ts';
import { fetchPage } from '../server/providers/ltaSpeedPages.ts';
import { fetchLtaAll } from '../server/providers/lta.ts';
import { probe } from '../server/healthProbes.ts';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const networkError = (code: string) => new TypeError('synthetic-private-detail', { cause: Object.assign(new Error('synthetic-private-detail'), { code }) });
function harness() {
  let now = Date.parse('2026-10-23T00:00:00Z');
  const calls: { url: string; init: RequestInit }[] = [];
  const waits: number[] = [];
  let reply: () => Promise<Response> = async () => Response.json({ ok: true });
  const read = createProviderReader({
    fetch: async (url, init = {}) => { calls.push({ url: String(url), init }); return reply(); },
    now: () => now, random: () => 0,
    sleep: async (ms, signal) => { signal?.throwIfAborted(); waits.push(ms); now += ms; },
  });
  return { read, calls, waits, now: () => now, reply: (fn: typeof reply) => { reply = fn; } };
}

test('read retries use bounded exponential backoff, preserve signed bytes/headers and cancel discarded bodies', async () => {
  const h = harness();
  let cancelled = 0;
  h.reply(async () => h.calls.length < 4 ? new Response(new ReadableStream({ cancel() { cancelled++; } }), { status: 503 }) : Response.json({ ok: true }));
  const url = 'https://example.test/image?signature=synthetic%2Bvalue%2fexact';
  const headers = { AccountKey: 'synthetic-test-only' };
  assert.deepEqual(await h.read(url, (response) => response.json(), { headers }, { attempts: 4, baseDelayMs: 400, maxWaitMs: 1000 }), { ok: true });
  assert.deepEqual(h.waits, [400, 800, 1000]);
  assert.equal(cancelled, 3);
  assert.ok(h.calls.every((call) => call.url === url && call.init.headers === headers && call.init.signal instanceof AbortSignal));
});

test('only GET/HEAD without a body can repeat; mutation methods and even empty GET bodies cannot', async () => {
  for (const init of [{ method: 'POST' }, { method: 'PUT' }, { method: 'PATCH' }, { method: 'DELETE' }, { method: 'OPTIONS' }, { method: 'GET', body: '' }]) {
    const h = harness();
    h.reply(async () => new Response(null, { status: 503 }));
    await assert.rejects(h.read('https://example.test/read', (r) => r.json(), init, { attempts: 4 }), ProviderReadError);
    assert.equal(h.calls.length, 1);
    assert.deepEqual(h.waits, []);
    assert.equal(safeReadRequest(init), false);
  }
  for (const method of ['GET', 'HEAD']) assert.equal(safeReadRequest({ method }), true);
});

test('permanent HTTP errors, invalid payloads, redirects, TLS/SSRF failures and generic fetch errors fail fast', async () => {
  for (const status of [400, 401, 403, 404, 409, 413, 415, 422, 501, 505]) {
    const h = harness(); h.reply(async () => new Response(null, { status }));
    await assert.rejects(h.read('https://example.test/read', (r) => r.json()), (e: any) => e.status === status);
    assert.equal(h.calls.length, 1);
  }
  for (const error of [new InvalidPayloadError(), new SyntaxError('bad JSON'), new Error('bad envelope'), new SsrfError('SSRF_ADDRESS_BLOCKED'),
    networkError('CERT_HAS_EXPIRED'), networkError('UND_ERR_INVALID_ARG'), new TypeError('fetch failed'), new DOMException('Cancelled', 'AbortError')]) {
    const h = harness(); h.reply(async () => { throw error; });
    await assert.rejects(h.read('https://example.test/read', (r) => r.json()), (e) => e === error);
    assert.equal(h.calls.length, 1);
    assert.deepEqual(h.waits, []);
  }
  const h = harness();
  await assert.rejects(h.read('https://example.test/read', async () => { throw new InvalidPayloadError(); }), InvalidPayloadError);
  assert.equal(h.calls.length, 1, 'successful HTTP with invalid parsed data must not repeat');
});

test('known transient socket/DNS/timeout errors retry; unsafe nested causes and cancellation do not', async () => {
  for (const code of ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT']) {
    const h = harness(); h.reply(async () => { if (h.calls.length === 1) throw networkError(code); return Response.json({ ok: true }); });
    assert.deepEqual(await h.read('https://example.test/read', (r) => r.json()), { ok: true });
    assert.equal(h.calls.length, 2);
    assert.ok(!JSON.stringify(safeFailure('lta', networkError(code))).includes('synthetic-private-detail'));
  }
  assert.equal(transientReadError(new AggregateError([networkError('ECONNRESET'), networkError('CERT_HAS_EXPIRED')])), false);
  assert.equal(transientReadError(Object.assign(networkError('CERT_HAS_EXPIRED'), { code: 'ECONNRESET' })), false);
});

test('Retry-After seconds/dates are minimums; long or overflow hints do not cause early retries', async () => {
  for (const date of [false, true]) {
    const h = harness();
    const hint = date ? new Date(h.now() + 3000).toUTCString() : '3';
    h.reply(async () => h.calls.length === 1 ? new Response(null, { status: 503, headers: { 'Retry-After': hint } }) : Response.json({ ok: true }));
    await h.read('https://example.test/read', (r) => r.json());
    assert.deepEqual(h.waits, [3000]);
  }
  for (const hint of ['60', '9999999999999999999999999999999999']) {
    const h = harness(); h.reply(async () => new Response(null, { status: 429, headers: { 'Retry-After': hint } }));
    await assert.rejects(h.read('https://example.test/read', (r) => r.json()), (error) => {
      const headers = providerRetryHeaders(error, h.now());
      assert.equal(headers['Cache-Control'], 'no-store');
      if (hint === '60') assert.equal(headers['Retry-After'], '60');
      return error instanceof ProviderReadError;
    });
    assert.equal(h.calls.length, 1);
    assert.deepEqual(h.waits, []);
  }
  assert.equal(readRetryDelay(4, 400, 1200, 1, null), 1200);
  assert.equal(readRetryDelay(1, 400, 12000, 1, null), 500);
  assert.equal(readRetryDelay(1, 400, 12000, 0, 13000), null);
});

test('retries must fit one total deadline and aborted backoff cannot start another attempt', async (t) => {
  const h = harness(); h.reply(async () => new Response(null, { status: 503, headers: { 'Retry-After': '2' } }));
  await assert.rejects(h.read('https://example.test/read', (r) => r.json(), {}, { timeoutMs: 1000 }), ProviderReadError);
  assert.equal(h.calls.length, 1); assert.deepEqual(h.waits, []);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const parent = new AbortController(); let calls = 0;
  const read = createProviderReader({ fetch: async () => { calls++; return new Response(null, { status: 503 }); }, now: Date.now, random: () => 0, sleep: waitForRetry });
  const pending = read('https://example.test/read', (r) => r.json(), { signal: parent.signal });
  const rejected = assert.rejects(pending, (e: any) => e.name === 'AbortError');
  await tick(); parent.abort(); await rejected;
  t.mock.timers.tick(20000); await tick();
  assert.equal(calls, 1);
  let signal!: AbortSignal;
  const stalled = createProviderReader({ fetch: async (_url, init) => { signal = init!.signal!; return new Promise<Response>(() => {}); }, now: Date.now, random: () => 0, sleep: waitForRetry });
  const waiting = stalled('https://example.test/read', (r) => r.json(), {}, { timeoutMs: 100 });
  const timedOut = assert.rejects(waiting, (e: any) => e.name === 'TimeoutError');
  await tick(); t.mock.timers.tick(100); await timedOut;
  assert.equal(signal.aborted, true);
});

test('LTA page integrations stop on invalid credentials/payloads and health probes stay single-attempt', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(null, { status: 401 }); });
  await assert.rejects(fetchPage(0, 'synthetic-key'), (e: any) => e.status === 401);
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(fetchLtaAll('https://example.test/data', 'synthetic-key', { wave: 1, maxPages: 1 }), (e: any) => e.status === 401);
  assert.equal(calls, 1);
  calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ error: 'not a value list' }); });
  await assert.rejects(fetchPage(0, 'synthetic-key'), InvalidPayloadError);
  assert.equal(calls, 1);
  calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(null, { status: 503 }); });
  assert.equal((await probe('https://example.test/probe')).status, 'DOWN');
  assert.equal(calls, 1);
});

test('paced weather reads recover once from transient failure but never retry malformed or probe responses', async () => {
  for (const mode of ['socket', 'timeout', '503', 'invalid', 'probe']) {
    let calls = 0, now = 1000;
    const waits: number[] = [];
    const client = createDataGovClient({ fetch: async () => {
      calls++;
      if (mode === 'invalid') return Response.json({ code: 1, errorMsg: 'synthetic-private-detail' });
      if (calls === 1) {
        if (mode === 'socket') throw networkError('ECONNRESET');
        if (mode === 'timeout') throw new DOMException('Timed out', 'TimeoutError');
        return new Response(null, { status: 503 });
      }
      return Response.json({ code: 0, data: { ok: true } });
    }, now: () => now, random: () => 0, sleep: async (ms) => { waits.push(ms); now += ms; }, intervalMs: 2100,
    retryDelayMs: 10000, transientRetryDelayMs: 400, maxRetryWaitMs: 12000, timeoutMs: 1000, budgetMs: 25000 });
    if (mode === 'invalid' || mode === 'probe') {
      await assert.rejects(client.data('https://example.test/rain', { retry: mode !== 'probe' }));
      assert.equal(calls, 1);
    } else {
      const request = client.data('https://example.test/rain');
      assert.equal(client.data('https://example.test/rain'), request);
      assert.deepEqual(await request, { ok: true });
      assert.equal(calls, 2);
      assert.ok(waits.reduce((a, b) => a + b, 0) >= 2100, 'retry uses the same provider pacing gate');
    }
  }
});
