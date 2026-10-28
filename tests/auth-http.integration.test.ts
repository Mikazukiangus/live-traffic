import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { getMigrations } from 'better-auth/db/migration';
import { createAuthService } from '../server/auth/service.ts';
import { createAuthHandler } from '../server/auth/handler.ts';
import { createApiMiddleware } from '../server/apiMiddleware.ts';

test('real Node HTTP parsing, cookies and SQLite session storage complete login/session/logout with safe failures', async () => {
  const db = new DatabaseSync(':memory:'), secret = 'synthetic-http-auth-signing-key-longer-than-32-characters';
  const origin = 'https://fixture.test', password = 'Synthetic-http-password-123', email = 'http-auth@example.test';
  const service = createAuthService({ database: db, secret, origin, secureCookies: true, allowEnrollment: true });
  await (await getMigrations(service.options)).runMigrations();
  await service.api.signUpEmail({ body: { name: 'HTTP fixture', email, password } });
  const handler = createAuthHandler({ service: () => service, origin, origins: [origin], clientIp: () => '203.0.113.8', logIdentitySecret: secret });
  const middleware = createApiMiddleware({ '/api/live': async () => ({ default: handler }) });
  const server = createServer((req, res) => { void middleware(req, res, () => { res.statusCode = 404; res.end(); }); });
  const previousError = console.error, previousWarn = console.warn, logs: string[] = [];
  console.error = console.warn = value => { logs.push(String(value)); };
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const post = (route: string, value: unknown = {}, cookie = '') => fetch(base + '/api/auth/' + route, { method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: typeof value === 'string' ? value : JSON.stringify(value) });
    const invalid = await post('sign-in', { email, password: 'wrong-password' });
    assert.equal(invalid.status, 401); assert.equal((await invalid.json()).code, 'AUTH_REJECTED');
    const login = await post('sign-in', { email, password }); assert.equal(login.status, 200);
    const cookies = login.headers.getSetCookie(); assert.ok(cookies.some(cookie => /;\s*HttpOnly/i.test(cookie) && /;\s*Secure/i.test(cookie)));
    const cookie = cookies.map(value => value.split(';')[0]).join('; ');
    const signedIn = await login.json(); assert.equal(signedIn.user.email, email); assert.equal('token' in signedIn, false);
    const session = await post('session', {}, cookie); assert.equal(session.status, 200); assert.equal((await session.json()).authenticated, true);
    assert.match(session.headers.get('cache-control')!, /private.*no-store/);
    const malformed = await post('sign-in', '{not JSON'); assert.equal(malformed.status, 400); assert.equal((await malformed.json()).code, 'INVALID_AUTH_REQUEST');
    const tooLarge = await post('sign-in', 'x'.repeat(4097)); assert.equal(tooLarge.status, 413); await tooLarge.text();
    const logout = await post('sign-out', {}, cookie); assert.equal(logout.status, 200); await logout.text();
    const revoked = await post('session', {}, cookie); assert.equal((await revoked.json()).authenticated, false);
    for (const value of [secret, password, email, cookie]) assert.ok(!logs.join('\n').includes(value));
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    db.close(); console.error = previousError; console.warn = previousWarn;
  }
});
