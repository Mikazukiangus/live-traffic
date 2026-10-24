import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { getMigrations } from 'better-auth/db/migration';
import { verify } from '@node-rs/argon2';
import { createAuthService, hasAuthCookie } from '../server/auth/service.ts';
import { createAuthHandler } from '../server/auth/handler.ts';
import { authBody, authRoute, isAuthTransport, validateAuthOrigin, AuthRequestError } from '../server/auth/request.ts';
import { validatedAuthCookies } from '../server/auth/respond.ts';
import { createUserAdmission } from '../server/auth/userAdmission.ts';
import { createConfig, createPublicConfig } from '../config/schema.ts';
import { auditTransportSource } from '../scripts/transport-audit.ts';
import { accountRequest, accountUser } from '../src/features/auth/authClient.ts';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { serviceWorkerSource, workerGlobals } from './helpers/serviceWorker.ts';

const origin = 'https://app.example.test';
const secret = 'synthetic-auth-signing-secret-longer-than-32-characters';
const password = 'Synthetic-password-42';
const reject = (status: number) => (error: unknown) => error instanceof AuthRequestError && error.status === status;
function post(route: string, body: unknown = {}, extra: Record<string, string> = {}) {
  return new Request(`${origin}/api/auth/${route}`, { method: 'POST', headers: { origin, 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) });
}
async function fixture() {
  const db = new DatabaseSync(':memory:');
  const options = { database: db, secret, origin, secureCookies: true };
  const enrollment = createAuthService({ ...options, allowEnrollment: true });
  await (await getMigrations(enrollment.options)).runMigrations();
  const runtime = createAuthService(options);
  const handler = createAuthHandler({ service: () => runtime, origin, origins: [origin], clientIp: () => '203.0.113.8' });
  return { db, runtime, handler, enrollment, options };
}

test('real authentication hashes salted Argon2id credentials, keeps signup closed, and emits safe session DTOs/cookies', async () => {
  const f = await fixture();
  try {
    for (const email of ['first@example.test', 'second@example.test']) await f.enrollment.api.signUpEmail({ body: { name: 'Synthetic user', email, password } });
    const rows = f.db.prepare('SELECT password FROM tp_auth_account').all() as { password: string }[];
    assert.equal(rows.length, 2); assert.notEqual(rows[0].password, rows[1].password);
    assert.ok(rows.every((r) => r.password.startsWith('$argon2id$v=19$m=65536,t=3,p=1$')));
    assert.equal(await verify(rows[0].password, password), true);
    assert.equal(await verify(rows[0].password, 'wrong-password'), false);
    const signup = await f.runtime.handler(post('sign-up/email', { name: 'Denied', email: 'blocked@example.test', password }));
    assert.ok(signup.status >= 400);
    assert.equal((await f.handler(post('sign-up/email', { name: 'Denied', email: 'blocked@example.test', password }))).status, 404);
    const login = await f.handler(post('sign-in', { email: 'FIRST@example.test', password }));
    assert.equal(login.status, 200);
    const cookies = login.headers.getSetCookie(); assert.equal(cookies.length, 1);
    validatedAuthCookies(cookies, true);
    const data = await login.json();
    assert.deepEqual(Object.keys(data).sort(), ['success', 'user']);
    assert.equal(data.user.email, 'first@example.test');
    assert.ok(!JSON.stringify(data).includes(password));
    assert.ok(!JSON.stringify(data).includes('token'));
    const session = await f.handler(post('session', {}, { cookie: cookies.map((v: string) => v.split(';')[0]).join('; ') }));
    assert.equal(session.status, 200);
    const sessionData = await session.json(); assert.equal(sessionData.authenticated, true);
    assert.deepEqual(Object.keys(sessionData).sort(), ['authenticated', 'user']);
    for (const name of ['cache-control', 'cdn-cache-control', 'vercel-cdn-cache-control']) assert.match(session.headers.get(name)!, /no-store/);
    assert.equal((await f.handler(new Request(`${origin}/api/auth/session`))).status, 405, 'legacy workers must never cache account reads');
  } finally { f.db.close(); }
});

test('wrong/unknown credentials are indistinguishable and signed-out/revoked sessions fail verification across instances', async () => {
  const f = await fixture();
  try {
    await f.enrollment.api.signUpEmail({ body: { name: 'Synthetic', email: 'known@example.test', password } });
    const wrong = await f.handler(post('sign-in', { email: 'known@example.test', password: 'wrong-password' }));
    const unknown = await f.handler(post('sign-in', { email: 'unknown@example.test', password: 'wrong-password' }));
    assert.equal(wrong.status, unknown.status); assert.deepEqual(await wrong.json(), await unknown.json());
    const login = await f.handler(post('sign-in', { email: 'known@example.test', password }));
    const cookie = login.headers.getSetCookie().map((v: string) => v.split(';')[0]).join('; ');
    const independent = createAuthService(f.options);
    assert.ok((await independent.api.getSession({ headers: new Headers({ cookie }) }))?.user.id);
    assert.equal((await f.handler(post('sign-out', {}, { cookie }))).status, 200);
    assert.equal(await independent.api.getSession({ headers: new Headers({ cookie }) }), null);
    const forged = await f.handler(post('session', {}, { cookie: '__Secure-trafficpulse.session_token=forged' }));
    assert.deepEqual(await forged.json(), { authenticated: false });
  } finally { f.db.close(); }
});

test('database-backed sign-in throttles atomically across two auth instances and returns Retry-After', async () => {
  const f = await fixture();
  try {
    await f.enrollment.api.signUpEmail({ body: { name: 'Synthetic', email: 'limited@example.test', password } });
    const second = createAuthHandler({ service: () => createAuthService(f.options), origin, origins: [origin], clientIp: () => '203.0.113.8' });
    const attempts = await Promise.all(Array.from({ length: 7 }, (_, i) => (i % 2 ? second : f.handler)(post('sign-in', { email: 'limited@example.test', password }))));
    assert.equal(attempts.filter((r) => r.status === 200).length, 5);
    assert.equal(attempts.filter((r) => r.status === 429).length, 2);
    for (const r of attempts.filter((r) => r.status === 429)) assert.match(r.headers.get('retry-after')!, /^\d+$/);
  } finally { f.db.close(); }
});

test('password changes verify current credentials and revoke other sessions', async () => {
  const f = await fixture();
  try {
    await f.enrollment.api.signUpEmail({ body: { name: 'Synthetic', email: 'change@example.test', password } });
    const cookies: string[] = [];
    for (let i = 0; i < 2; i++) { const r = await f.handler(post('sign-in', { email: 'change@example.test', password })); cookies.push(r.headers.getSetCookie().map((v: string) => v.split(';')[0]).join('; ')); }
    const change = await f.handler(post('change-password', { currentPassword: password, newPassword: 'New-synthetic-password-42' }, { cookie: cookies[0] }));
    assert.equal(change.status, 200);
    assert.equal(await f.runtime.api.getSession({ headers: new Headers({ cookie: cookies[1] }) }), null);
    const old = await f.handler(post('sign-in', { email: 'change@example.test', password })); assert.equal(old.status, 401);
    const current = await f.handler(post('sign-in', { email: 'change@example.test', password: 'New-synthetic-password-42' })); assert.equal(current.status, 200);
  } finally { f.db.close(); }
});

test('auth boundaries reject CSRF, ambiguous routing, extra fields, unsupported media and oversized bodies before storage', async () => {
  let touched = 0;
  const handler = createAuthHandler({ service: () => { touched++; throw new Error('private-db-marker'); }, origin, origins: [origin], clientIp: () => '203.0.113.8' });
  for (const [request, status] of [
    [post('sign-in', { email: 'test@example.test', password }, { origin: 'https://evil.test' }), 403],
    [post('sign-in', { email: 'test@example.test', password }, { 'sec-fetch-site': 'cross-site' }), 403],
    [new Request(`${origin}/api/auth/sign-in`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }), 403],
    [post('sign-in', { email: 'test@example.test', password, role: 'admin' }), 400],
    [post('sign-in', { email: 'test@example.test', password, callbackURL: 'https://evil.test' }), 400],
    [post('sign-in', { email: 'not-email', password }), 400],
    [post('sign-in', { email: 'test@example.test', password: 'x'.repeat(5000) }), 413],
    [post('sign-in', {}, { 'content-type': 'text/plain' }), 415],
    [post('sign-in', {}, { 'content-encoding': 'gzip' }), 415],
    [post('session', { userId: 'forged' }), 400],
    [new Request(`${origin}/api/live?feed=auth&authPath=session&authPath=sign-in`), 400],
    [new Request(`${origin}/api/live?feed=auth&authPath=../../traffic`), 404],
  ] as const) assert.equal((await handler(request)).status, status);
  assert.equal(touched, 0);
  assert.throws(() => validateAuthOrigin(new Headers({ origin: origin + ',https://evil.test' }), 'POST', [origin]), reject(403));
  assert.equal(authRoute(post('sign-in')), 'sign-in');
  assert.equal(authRoute(new Request(`${origin}/api/auth/ok?feed=auth&authPath=ok`)), 'ok');
  assert.throws(() => authRoute(new Request(`${origin}/api/auth/ok?feed=auth&authPath=session`)), reject(400));
  assert.equal(authRoute({ url: '/api/live', method: 'POST', query: { feed: 'auth', authPath: 'session' } }), 'session');
  assert.throws(() => authRoute({ url: '/api/live', method: 'POST', query: { feed: 'auth', authPath: ['session', 'sign-in'] } }), reject(400));
  assert.throws(() => authRoute({ url: '/api/live?authPath=session', method: 'POST', query: { feed: 'auth', authPath: 'session' } }), reject(400));
  assert.equal(isAuthTransport({ url: '/api/live?feed=auth&authPath=session' }), true);
  assert.equal(isAuthTransport({ url: '/api/live?feed=carparks' }), false);
  const disabled = createAuthHandler({ service: () => null, origin, origins: [origin] });
  assert.equal((await disabled(post('session'))).status, 503);
});

test('Node auth route preserves multiple response cookies and does not send raw sessions or internal failures', async () => {
  const f = await fixture();
  try {
    await f.enrollment.api.signUpEmail({ body: { name: 'Synthetic', email: 'node@example.test', password } });
    const res = { statusCode: 0, headers: {} as Record<string, string | string[]>, body: '',
      setHeader(name: string, value: string | string[]) { this.headers[name.toLowerCase()] = value; }, end(value: string) { this.body = value; return this; } };
    await f.handler({ method: 'POST', url: '/api/auth/sign-in', headers: { origin, 'content-type': 'application/json' }, body: { email: 'node@example.test', password } }, res);
    assert.equal(res.statusCode, 200); assert.ok(Array.isArray(res.headers['set-cookie']));
    assert.ok(!res.body.includes('token')); assert.ok(!res.body.includes(password));
    const failing = createAuthHandler({ service: () => { throw new Error('private-db-marker'); }, origin, origins: [origin] });
    const response = await failing(post('session')); assert.equal(response.status, 503); assert.ok(!(await response.text()).includes('private-db-marker'));
  } finally { f.db.close(); }
});

test('cookie write boundary requires host-only HttpOnly/Lax/root scope and deployment Secure, while source gate catches other writers', () => {
  const good = '__Secure-trafficpulse.session_token=synthetic; Path=/; HttpOnly; Secure; SameSite=Lax';
  assert.deepEqual(validatedAuthCookies([good], true), [good]);
  for (const cookie of [good.replace('; Secure', ''), good.replace('; HttpOnly', ''), good.replace('SameSite=Lax', 'SameSite=None'),
    good.replace('Path=/', 'Path=/sub'), good + '; Domain=.example.test', good.replace('trafficpulse', 'other'), good + '\r\nInjected: x']) assert.throws(() => validatedAuthCookies([cookie], true));
  assert.equal(auditTransportSource('server/auth/respond.ts', 'res.setHeader("Set-Cookie", "unsafe")')[0].code, 'COOKIE_POLICY_REVIEW');
  assert.equal(auditTransportSource('src/unsafe.ts', "document.cookie='unsafe'")[0].code, 'COOKIE_POLICY_REVIEW');
});

test('user middleware verifies actual sessions before cache, applies independent hashed user quotas across IPs, and ignores forged IDs', async () => {
  const f = await fixture();
  try {
    await f.enrollment.api.signUpEmail({ body: { name: 'Synthetic', email: 'quota@example.test', password } });
    const login = await f.handler(post('sign-in', { email: 'quota@example.test', password }));
    const cookie = login.headers.getSetCookie().map((v: string) => v.split(';')[0]).join('; ');
    const keys: string[] = []; let wouldReachCache = 0;
    const admit = createUserAdmission({ enabled: true, mode: 'enforce', host: 'synthetic.vercel.app', namespace: 'preview',
      verify: (headers) => f.runtime.api.getSession({ headers, query: { disableCookieCache: true } }),
      check: async ({ key }) => { keys.push(key); return { rateLimited: keys.length > 2 }; } });
    for (const ip of ['203.0.113.8', '203.0.113.9', '203.0.113.10']) {
      const result = await admit(new Request(`${origin}/api/rainforecast?limit=1`, { headers: { cookie, 'x-real-ip': ip, 'x-user-id': 'forged' } }));
      if (!result) wouldReachCache++; else { assert.equal(result.status, 429); assert.equal(result.headers.get('retry-after'), '60'); assert.match(result.headers.get('cache-control')!, /no-store/); }
    }
    assert.equal(wouldReachCache, 2); assert.equal(new Set(keys).size, 1);
    assert.equal(await admit(new Request(`${origin}/api/traffic`, { headers: { cookie: '__Secure-trafficpulse.session_token=forged', 'x-real-ip': '203.0.113.8', 'x-user-id': 'quota' } })), null);
    assert.equal(keys.length, 3);
    await f.handler(post('sign-out', {}, { cookie }));
    assert.equal(await admit(new Request(`${origin}/api/traffic`, { headers: { cookie, 'x-real-ip': '203.0.113.8' } })), null);
    assert.equal(keys.length, 3);
  } finally { f.db.close(); }
});

test('user admission fails closed on verifier/storage/rule failures, and skips anonymous/preflight/auth/off requests', async () => {
  for (const failure of ['verify', 'missing-rule', 'invalid-result']) {
    const admit = createUserAdmission({ enabled: true, mode: 'enforce', host: 'synthetic.vercel.app', namespace: 'preview',
      verify: async () => { if (failure === 'verify') throw new Error('private-verifier-marker'); return { user: { id: 'one' } }; },
      check: async () => failure === 'missing-rule' ? { rateLimited: false, error: 'not-found' } : {} as any });
    const response = await admit(new Request(`${origin}/api/traffic`, { headers: { cookie: '__Secure-trafficpulse.session_token=synthetic', 'x-real-ip': '203.0.113.8' } }));
    assert.equal(response?.status, 503); assert.ok(!(await response!.text()).includes('private-verifier-marker'));
  }
  let verified = 0;
  const opts = { enabled: true, mode: 'enforce' as const, host: 'synthetic.vercel.app', namespace: 'preview', verify: async () => { verified++; return null; } };
  const admit = createUserAdmission(opts);
  for (const request of [new Request(`${origin}/api/traffic`), post('session'), new Request(`${origin}/api/traffic`, { method: 'OPTIONS' })]) assert.equal(await admit(request), null);
  assert.equal(await createUserAdmission({ ...opts, mode: 'off' })(new Request(`${origin}/api/traffic`, { headers: { cookie: 'trafficpulse.session_token=synthetic' } })), null);
  assert.equal(verified, 0);
  assert.equal(hasAuthCookie(new Headers({ cookie: 'unrelated=1' })), false);
  const log = console.info, events: string[] = [];
  console.info = (value: string) => { events.push(value); };
  try {
    const observed = createUserAdmission({ ...opts, mode: 'observe', verify: async () => ({ user: { id: 'private-account-marker' } }), check: async () => ({ rateLimited: false }) });
    for (let i = 0; i < 2; i++) await observed(new Request(`${origin}/api/traffic`, { headers: { cookie: 'trafficpulse.session_token=private-cookie-marker', 'x-real-ip': '203.0.113.8' } }));
    assert.deepEqual(events.map(value => JSON.parse(value)), [{ event: 'user_rate_limit', code: 'RATE_LIMIT_ALLOWED' }]);
  } finally { console.info = log; }
});

test('authentication config is validated, disabled by default, server-only, with exact preview origins', () => {
  assert.equal(createConfig().server.auth.enabled, false); assert.equal(createPublicConfig().authEnabled, false);
  for (const env of [{ AUTH_ENABLED: 'true' }, { VITE_AUTH_ENABLED: 'true' }, { BETTER_AUTH_SECRET: 'short' },
    { DATABASE_URL: 'postgres://user:private-marker@untrusted.test/db' }]) assert.throws(() => createConfig(env), (e: any) => !e.message.includes('private-marker'));
  const c = createConfig({ AUTH_ENABLED: 'true', DATABASE_URL: 'postgresql://synthetic:synthetic@ep-fixture.neon.tech/neondb', BETTER_AUTH_SECRET: secret,
    VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_URL: 'synthetic.vercel.app', VERCEL_BRANCH_URL: 'synthetic-branch.vercel.app' });
  assert.equal(c.server.auth.secureCookies, true); assert.equal(c.server.auth.origin, 'https://synthetic.vercel.app');
  assert.ok(c.server.auth.origins.includes('https://synthetic-branch.vercel.app'));
  assert.ok(!JSON.stringify(createPublicConfig({ BETTER_AUTH_SECRET: secret, DATABASE_URL: 'private-db-marker' })).includes(secret));
  const v = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(v.proxy.entrypoint, 'proxy.ts'); assert.deepEqual(v.proxy.matcher, ['/api/:path*']);
  assert.ok(v.rewrites.some((r: any) => r.source.startsWith('/api/auth/') && r.destination.startsWith('/api/live?feed=auth')));
  assert.ok(v.rewrites.some((r: any) => r.source === '/api/forecast24h' && r.destination === '/api/live?feed=forecast24h'));
});

test('account client uses POST/no-store even for session lookup and never exposes server error text', async () => {
  const original = globalThis.fetch; const calls: RequestInit[] = [];
  globalThis.fetch = async (_input, init) => { calls.push(init!); return Response.json({ authenticated: false }); };
  try {
    await accountRequest('session'); assert.equal(calls[0].method, 'POST'); assert.equal(calls[0].cache, 'no-store'); assert.equal(calls[0].credentials, 'same-origin');
    assert.throws(() => accountUser({ id: 'one', name: 'n', email: 'x'.repeat(300) }));
    globalThis.fetch = async () => new Response('private-provider-marker', { status: 503 });
    await assert.rejects(accountRequest('sign-in', { email: 'x@example.test', password }), (e: any) => !e.message.includes('private-provider-marker'));
  } finally { globalThis.fetch = original; }
});

test('worker treats auth URLs as network-only with no session/account persistence or offline fallback', async () => {
  let listener: any; let stores = 0;
  const context = { ...workerGlobals(), self: { location: { origin }, addEventListener: (name: string, value: any) => { if (name === 'fetch') listener = value; } },
    caches: { open: async () => { stores++; throw new Error('auth must not touch storage'); }, match: async () => { stores++; throw new Error('auth must not read storage'); } },
    fetch: async () => Response.json({ success: true }) };
  runInNewContext(await serviceWorkerSource(), context);
  for (const url of ['/api/auth/ok', '/api/live?feed=auth&authPath=ok']) {
    let response!: Promise<Response>; listener({ request: new Request(origin + url), respondWith: (value: Promise<Response>) => { response = value; } });
    assert.equal((await response).status, 200);
  }
  assert.equal(stores, 0);
});
