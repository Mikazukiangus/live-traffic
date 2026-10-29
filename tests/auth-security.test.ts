import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { getMigrations } from 'better-auth/db/migration';
import { createAuthService } from '../server/auth/service.ts';
import { createAuthHandler } from '../server/auth/handler.ts';

const origin = 'https://audit.example.test';
const secret = 'synthetic-audit-secret-more-than-32-characters';
const password = 'Synthetic-audit-password-42';
const email = 'audit@example.test';
const request = (route: string, body: unknown = {}, cookie = '', ip = '203.0.113.8') =>
  new Request(`${origin}/api/auth/${route}`, { method: 'POST', headers: {
    origin, 'content-type': 'application/json', cookie, 'x-test-peer': ip,
  }, body: JSON.stringify(body) });

async function fixture() {
  const db = new DatabaseSync(':memory:');
  const options = { database: db, secret, origin, secureCookies: true };
  const enrollment = createAuthService({ ...options, allowEnrollment: true });
  await (await getMigrations(enrollment.options)).runMigrations();
  await enrollment.api.signUpEmail({ body: { name: 'Audit fixture', email, password } });
  const service = createAuthService(options);
  const handlerFor = (auth = service) => createAuthHandler({ service: () => auth, origin, origins: [origin],
    clientIp: req => req.headers.get('x-test-peer'), logIdentitySecret: secret });
  const handler = handlerFor();
  const login = await handler(request('sign-in', { email, password }));
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie().map((value: string) => value.split(';')[0]).join('; ');
  return { db, service, handler, handlerFor, options, cookie };
}

test('account attempt budget is atomic across instances and IP rotation, private, and expires without extending lockout', async () => {
  const f = await fixture();
  const warn = console.warn; console.warn = () => {};
  try {
    const second = f.handlerFor(createAuthService(f.options));
    // Unknown and known accounts get the same budget; no account lookup or existence leak.
    const unknown = 'absent@example.test';
    const responses = await Promise.all(Array.from({ length: 16 }, (_, i) =>
      (i % 2 ? second : f.handler)(request('sign-in', { email: i % 2 ? unknown.toUpperCase() : unknown,
        password: 'wrong-password' }, '', `203.0.113.${i + 20}`))));
    assert.equal(responses.filter(r => r.status === 401).length, 10);
    assert.equal(responses.filter(r => r.status === 429).length, 6);
    for (const r of responses.filter(r => r.status === 429)) assert.match(r.headers.get('retry-after')!, /^\d+$/);
    const before = f.db.prepare("SELECT key, count, lastRequest FROM tp_auth_rate_limit WHERE key LIKE 'account-v1:%'").all();
    assert.ok(before.length > 0);
    assert.ok(!JSON.stringify(before).includes(unknown));
    const locked = await second(request('sign-in', { email: unknown, password }, '', '203.0.113.100'));
    assert.equal(locked.status, 429);
    assert.deepEqual(f.db.prepare("SELECT key, count, lastRequest FROM tp_auth_rate_limit WHERE key LIKE 'account-v1:%'").all(), before);
    f.db.prepare("UPDATE tp_auth_rate_limit SET lastRequest=? WHERE key LIKE 'account-v1:%'").run(Date.now() - 901_000);
    assert.equal((await second(request('sign-in', { email: unknown, password }, '', '203.0.113.101'))).status, 401);
    assert.equal((await f.handler(request('sign-in', { email, password }, '', '203.0.113.102'))).status, 200);
  } finally { console.warn = warn; f.db.close(); }
});

test('logout reports storage failure rather than false success; retry revokes the copied cookie', async () => {
  const f = await fixture();
  const prepare = f.db.prepare.bind(f.db), warn = console.warn;
  console.warn = () => {};
  try {
    let deletes = 0;
    f.db.prepare = (sql: string) => {
      if (/^\s*delete\s+from\s+"?tp_auth_session/i.test(sql)) { deletes++; throw new Error('synthetic-private-storage-failure'); }
      return prepare(sql);
    };
    const response = await f.handler(request('sign-out', {}, f.cookie));
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.success, false); assert.equal(body.code, 'AUTH_UNAVAILABLE');
    assert.ok(!JSON.stringify(body).includes('synthetic-private-storage-failure'));
    assert.ok(deletes > 0);
    f.db.prepare = prepare;
    assert.equal((await (await f.handler(request('session', {}, f.cookie))).json()).authenticated, true);
    assert.equal((await f.handler(request('sign-out', {}, f.cookie))).status, 200);
    assert.equal((await (await f.handler(request('session', {}, f.cookie))).json()).authenticated, false);
  } finally { f.db.prepare = prepare; console.warn = warn; f.db.close(); }
});

test('GET verification never refreshes or deletes session rows and sessions have an absolute age limit', async () => {
  const f = await fixture();
  try {
    const now = Date.now();
    f.db.prepare('UPDATE tp_auth_session SET createdAt=?, updatedAt=?, expiresAt=?').run(now - 7_200_000, now - 7_200_000, now + 79_200_000);
    const before = f.db.prepare('SELECT * FROM tp_auth_session').get();
    const session = await f.service.api.getSession({ headers: new Headers({ cookie: f.cookie }), query: { disableCookieCache: true } });
    assert.ok(session?.user);
    assert.deepEqual(f.db.prepare('SELECT * FROM tp_auth_session').get(), before);
    // A previously sliding session must not outlive creation + 24h after this rollout.
    f.db.prepare('UPDATE tp_auth_session SET createdAt=?, expiresAt=?').run(now - 86_401_000, now + 3_600_000);
    assert.equal(await f.service.api.getSession({ headers: new Headers({ cookie: f.cookie }) }), null);
    assert.equal((await f.handler(request('change-password', { currentPassword: password, newPassword: 'Synthetic-changed-password-42' }, f.cookie))).status, 401);
    f.db.prepare('UPDATE tp_auth_session SET expiresAt=?').run(now - 1000);
    const expired = f.db.prepare('SELECT * FROM tp_auth_session').get();
    assert.equal(await f.service.api.getSession({ headers: new Headers({ cookie: f.cookie }) }), null);
    assert.deepEqual(f.db.prepare('SELECT * FROM tp_auth_session').get(), expired);
  } finally { f.db.close(); }
});
