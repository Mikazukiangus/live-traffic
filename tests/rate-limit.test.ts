import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimitGuard, platformClientIp, RateLimitRejection, vercelRateLimitCheck, type RateLimitCheck } from '../server/http/rateLimit.ts';
import { withRequestSchema } from '../server/http/validateRequest.ts';
import { requestSchemas } from '../server/http/requestSchemas.ts';
import { API_RATE_LIMITS } from '../config/rateLimitPolicy.ts';
import { createConfig, createPublicConfig } from '../config/schema.ts';
import { rateLimitRuleCommands } from '../scripts/rate-limit-rules.ts';
import { spawnSync } from 'node:child_process';

const settings = { mode: 'enforce', timeoutMs: 100, platform: true, namespace: 'preview', host: 'synthetic.vercel.app' } as const;
const req = (ip = '203.0.113.8', rest = {}) => ({ method: 'GET', url: '/api/test', headers: { 'x-real-ip': ip }, ...rest });
const quiet = () => {};
const allowed: RateLimitCheck = async () => ({ rateLimited: false });
const rejectStatus = (status: number) => (e: unknown) => e instanceof RateLimitRejection && e.status === status;

test('IP identity canonicalizes mapped IPv4 and IPv6 /64 and rejects ambiguous platform metadata', () => {
  assert.equal(platformClientIp(req('::ffff:203.0.113.8')), platformClientIp(req()));
  assert.equal(platformClientIp(req('2001:db8:abcd:1234::1')), platformClientIp(req('2001:db8:abcd:1234:5678::4')));
  assert.notEqual(platformClientIp(req('2001:db8:abcd:1235::1')), platformClientIp(req('2001:db8:abcd:1234::1')));
  assert.equal(platformClientIp(new Request('https://example.test', { headers: { 'x-real-ip': '203.0.113.8' } })), '203.0.113.8');
  for (const input of [req('', {}), req('203.0.113.8, 203.0.113.9'), req('fe80::1%eth0'), req('[2001:db8::1]'),
    req('203.0.113.8:80'), req('x'.repeat(100)), req('203.0.113.8', { headers: {} }),
    req('203.0.113.8', { headers: { 'x-real-ip': ['203.0.113.8'] } }),
    req('203.0.113.8', { rawHeaders: ['x-real-ip', '203.0.113.8', 'X-Real-IP', '203.0.113.9'] }),
    req('203.0.113.8', { headers: { 'x-real-ip': '203.0.113.8', 'X-Real-IP': '203.0.113.9' } })])
    assert.throws(() => platformClientIp(input), rejectStatus(503));
});

test('independent concurrent requests each consume admission; only admitted work runs', async () => {
  let counted = 0, work = 0;
  const guard = createRateLimitGuard({ settings, observe: quiet, check: async () => ({ rateLimited: ++counted > 7 }) });
  const results = await Promise.allSettled(Array.from({ length: 50 }, () => guard.run(req(), async () => ++work)));
  assert.equal(counted, 50);
  assert.equal(work, 7);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 7);
  assert.ok(results.filter((r) => r.status === 'rejected').every((r) => rejectStatus(429)(r.reason)));
});

test('all routes/query variations share an IP bucket; user and IP dimensions stay independent', async () => {
  const calls: Parameters<RateLimitCheck>[0][] = [];
  let verified: string | null = 'account-one';
  const guard = createRateLimitGuard({ settings, observe: quiet, check: async (input) => { calls.push(input); return { rateLimited: false }; },
    resolveVerifiedUser: async () => verified });
  for (const r of [req(), req('203.0.113.8', { url: '/api/imageproxy?url=synthetic' }), req('203.0.113.9')]) await guard.run(r, async () => {});
  assert.equal(calls[0].key, calls[2].key);
  assert.notEqual(calls[0].key, calls[4].key);
  assert.equal(calls[1].key, calls[5].key, 'user quota survives IP changes');
  assert.notEqual(calls[0].key, calls[1].key, 'user and IP cannot collide');
  verified = 'account-two'; await guard.run(req(), async () => {});
  assert.notEqual(calls[1].key, calls[7].key);
  assert.ok(!JSON.stringify(calls).includes('account-one'));
  verified = null; await guard.run(req(), async () => {});
  assert.equal(calls.length, 9, 'anonymous callers receive only the IP check');
});

test('verified user limit is enforced after IP; headers, query, cookies and request fields are never an identity', async () => {
  const calls: string[] = [];
  const guard = createRateLimitGuard({ settings, observe: quiet, check: async ({ id }) => { calls.push(id); return { rateLimited: calls.length === 2 }; },
    resolveVerifiedUser: async () => 'verified-account' });
  await assert.rejects(guard.run(req(), async () => assert.fail('must reject')), rejectStatus(429));
  assert.deepEqual(calls, [API_RATE_LIMITS.id, API_RATE_LIMITS.id]);
  let count = 0;
  const anonymous = createRateLimitGuard({ settings, observe: quiet, check: async () => { count++; return { rateLimited: false }; } });
  await anonymous.run(req('203.0.113.8', { userId: 'forged', user: { id: 'forged' }, url: '/api/test?userId=forged',
    headers: { 'x-real-ip': '203.0.113.8', 'x-user-id': 'forged', cookie: 'userId=forged', accountkey: 'provider-key' } }), async () => {});
  assert.equal(count, 1);
});

test('request-scoped admission deduplicates nested live dispatch and resets on the next invocation', async () => {
  let checks = 0, executions = 0;
  const guard = createRateLimitGuard({ settings, observe: quiet, check: async () => { checks++; return { rateLimited: false }; } });
  const inner = withRequestSchema(requestSchemas.empty, async () => { executions++; return Response.json({ success: true }); }, { rateLimit: guard });
  const outer = withRequestSchema(requestSchemas.empty, async (r) => inner(r), { rateLimit: guard });
  const same = req();
  for (let i = 0; i < 2; i++) assert.equal((await outer(same)).status, 200);
  assert.equal(checks, 2); assert.equal(executions, 2);
});

test('429 and limiter failures preserve Node/Web CORS, numeric Retry-After and no-store without running business logic', async () => {
  let work = 0;
  for (const failure of ['limit', 'not-found', 'blocked', 'throw', 'malformed']) {
    const guard = createRateLimitGuard({ settings, observe: quiet, check: async () => {
      if (failure === 'throw') throw new Error('synthetic-sensitive-marker');
      if (failure === 'malformed') return {} as any;
      return { rateLimited: failure === 'limit' || failure === 'blocked', ...(failure === 'not-found' || failure === 'blocked' ? { error: failure } : {}) };
    } });
    const handler = withRequestSchema(requestSchemas.empty, async () => { work++; return Response.json({}); }, { rateLimit: guard });
    const input = req('203.0.113.8', { headers: { 'x-real-ip': '203.0.113.8', origin: 'https://live-traffic-carbon-bc04.vercel.app' } });
    for (const mode of ['web', 'node']) {
      const res = mode === 'node' ? {
        statusCode: 0, body: null as unknown, headers: new Headers(),
        setHeader(name: string, value: string) { this.headers.set(name, value); },
        status(value: number) { this.statusCode = value; return this; }, json(value: unknown) { this.body = value; return this; },
      } : undefined;
      const response = await handler(input, res);
      const status = res ? res.statusCode : response.status;
      const headers = res ? res.headers : response.headers;
      const body = res ? res.body : await response.json();
      assert.equal(status, failure === 'limit' ? 429 : 503);
      assert.equal(headers.get('retry-after'), failure === 'limit' ? '60' : '5');
      assert.equal(headers.get('access-control-allow-origin'), 'https://live-traffic-carbon-bc04.vercel.app');
      for (const name of ['cache-control', 'cdn-cache-control', 'vercel-cdn-cache-control']) assert.equal(headers.get(name), 'no-store');
      assert.ok(!JSON.stringify(body).includes('synthetic-sensitive-marker'));
    }
  }
  assert.equal(work, 0);
});

test('OPTIONS and malformed requests stop before consuming origin quota', async () => {
  let calls = 0;
  const guard = createRateLimitGuard({ settings, observe: quiet, check: async () => { calls++; return { rateLimited: true }; } });
  const handler = withRequestSchema(requestSchemas.empty, async () => assert.fail('handler blocked'), { rateLimit: guard });
  assert.equal((await handler(req('203.0.113.8', { method: 'OPTIONS' }))).status, 204);
  assert.equal((await handler(req('203.0.113.8', { url: '/api/test?unknown=true' }))).status, 400);
  assert.equal((await handler(req('203.0.113.8', { method: 'POST' }))).status, 405);
  assert.equal(calls, 0);
});

test('timeouts and identity verification failures fail closed without retrying or leaking diagnostics', async () => {
  let calls = 0;
  const guard = createRateLimitGuard({ settings: { ...settings, timeoutMs: 10 }, observe: quiet,
    check: async () => { calls++; return new Promise(() => {}); } });
  await assert.rejects(guard.run(req(), async () => {}), rejectStatus(503)); assert.equal(calls, 1);
  for (const resolveVerifiedUser of [async () => { throw new Error('private-account-marker'); }, async () => '' ]) {
    const failed = createRateLimitGuard({ settings, observe: quiet, check: allowed, resolveVerifiedUser });
    await assert.rejects(failed.run(req(), async () => {}), rejectStatus(503));
  }
});

test('off is explicit, observe records without blocking, and enforce never trusts headers on other hosts', async () => {
  let checked = 0, work = 0;
  const outcomes: string[] = [];
  const check: RateLimitCheck = async () => { checked++; return { rateLimited: true }; };
  await createRateLimitGuard({ settings: { ...settings, mode: 'off' }, check }).run(req(), async () => work++);
  assert.equal(checked, 0);
  await createRateLimitGuard({ settings: { ...settings, mode: 'observe' }, check, observe: (o) => outcomes.push(o) }).run(req(), async () => work++);
  assert.deepEqual(outcomes, ['limited']); assert.equal(work, 2);
  for (const bad of [{ platform: false }, { host: 'attacker.example' }, { host: 'synthetic.vercel.app.evil.test' }, { host: '' }]) {
    const guard = createRateLimitGuard({ settings: { ...settings, ...bad }, check, observe: quiet });
    await assert.rejects(guard.run(req(), async () => work++), rejectStatus(503));
  }
  assert.equal(checked, 1); assert.equal(work, 2);
});

test('SDK transport pins deployment host, sends minimal headers, has a deadline and never retries', async () => {
  const original = globalThis.fetch, env = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const seen: { url: string; headers: Headers; signal?: AbortSignal | null }[] = [];
  globalThis.fetch = async (input, init) => { seen.push({ url: String(input), headers: new Headers(init?.headers), signal: init?.signal }); return new Response(null, { status: 204 }); };
  try {
    const guard = createRateLimitGuard({ settings, observe: quiet });
    await guard.run(req('203.0.113.8', { url: '/api/test?url=synthetic-private-query',
      headers: { 'x-real-ip': '203.0.113.8', host: 'attacker.example', accountkey: 'private-provider-key', cookie: 'private-cookie', authorization: 'private-token' } }), async () => {});
    assert.equal(seen.length, 1);
    assert.equal(new URL(seen[0].url).host, settings.host);
    assert.ok(seen[0].signal instanceof AbortSignal);
    const serialized = JSON.stringify([seen[0].url, Object.fromEntries(seen[0].headers)]);
    for (const secret of ['attacker.example', 'private-provider-key', 'private-cookie', 'private-token', 'synthetic-private-query']) assert.ok(!serialized.includes(secret));
    assert.equal(seen[0].headers.get('x-rr-host'), settings.host);
    assert.equal(seen[0].headers.has('x-rr-accountkey'), false);
    assert.equal(seen[0].headers.has('x-rr-cookie'), false);
    process.env.NODE_ENV = 'test';
    await assert.rejects(vercelRateLimitCheck({ id: 'synthetic-rule', key: 'opaque', ip: '203.0.113.8', host: settings.host, timeoutMs: 100 }), rejectStatus(503));
  } finally { globalThis.fetch = original; if (env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = env; }
});

test('settings are validated/server-only and emitted rule commands are log-only drafts with consistent IDs/windows', () => {
  assert.equal(createConfig().server.rateLimit.mode, 'off');
  assert.throws(() => createConfig({ API_RATE_LIMIT_MODE: 'true' }), /API_RATE_LIMIT_MODE/);
  assert.throws(() => createConfig({ API_RATE_LIMIT_TIMEOUT_MS: '0' }), /API_RATE_LIMIT_TIMEOUT_MS/);
  assert.equal('rateLimit' in createPublicConfig(), false);
  const commands = rateLimitRuleCommands();
  assert.equal(commands.length, 1);
  for (const command of commands) {
    assert.equal(command[command.indexOf('--rate-limit-action') + 1], 'log');
    assert.equal(command[command.indexOf('--rate-limit-window') + 1], '60');
    assert.ok(!command.includes('publish'));
  }
  assert.ok(commands[0].includes('--or'));
  assert.ok(JSON.stringify(commands).includes(API_RATE_LIMITS.id));
});

test('every real Node and Web endpoint rejects at the production guard before provider access', () => {
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    let checks = 0;
    globalThis.fetch = async (url) => {
      assert.equal(new URL(String(url)).host, 'synthetic.vercel.app', 'provider must not run');
      assert.ok(String(url).includes('/.well-known/vercel/rate-limit-api/'));
      checks++;
      return new Response(null, { status: 429 });
    };
    console.warn = () => {};
    const names = ['traffic', 'trafficflow', 'vms', 'traveltimes', 'trafficimages', 'expresswayspeeds',
      'health', 'rainforecast', 'forecast24h', 'airquality', 'imageproxy', 'live',
      '_carparks', '_roadconditions', '_weatheralerts', '_floods'];
    for (const name of names) {
      const module = await import('./api/' + name + '.ts');
      const query = name === 'live' ? '?feed=carparks' : name === 'imageproxy' ? '?url=https%3A%2F%2Fimages.data.gov.sg%2Fsynthetic.jpg' : '';
      const url = 'https://synthetic.vercel.app/api/' + name + query;
      const web = await (module.GET ?? module.default)(new Request(url, { headers: { 'x-real-ip': '203.0.113.8' } }));
      assert.equal(web.status, 429, name);
      const res = { statusCode: 0, headers: {},
        setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
        status(s) { this.statusCode = s; return this; }, json(b) { this.body = b; return this; } };
      await module.default({ method: 'GET', url, headers: { 'x-real-ip': '203.0.113.8' } }, res);
      assert.equal(res.statusCode, 429, name);
      assert.equal(res.headers['retry-after'], '60', name);
    }
    assert.equal(checks, names.length * 2);
  `], {
    cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 15_000,
    env: { PATH: process.env.PATH, NODE_ENV: 'production', VERCEL: '1', VERCEL_ENV: 'preview',
      VERCEL_URL: 'synthetic.vercel.app', API_RATE_LIMIT_MODE: 'enforce', LTA_ACCOUNT_KEY: 'synthetic-fixture-only' },
  });
  assert.equal(child.status, 0, 'synthetic production-boundary fixture failed');
});
