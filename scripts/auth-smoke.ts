import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { config } from '../config/server.ts';
import { createAuthPool } from '../server/auth/database.ts';
import { createAuthService } from '../server/auth/service.ts';
import { createAuthHandler } from '../server/auth/handler.ts';
import { validatedAuthCookies } from '../server/auth/respond.ts';

/** Real isolated preview DB, synthetic account only; no credentials/cookies are output. */
export async function smokeAuth() {
  if (!config.server.auth.databaseUrl || !config.server.auth.secret) throw new Error('Missing smoke settings');
  const pool = createAuthPool(config.server.auth.databaseUrl);
  const origin = 'https://auth-smoke.example.test';
  const options = { database: pool, secret: config.server.auth.secret, origin, secureCookies: true };
  const enrollment = createAuthService({ ...options, allowEnrollment: true });
  const auth = createAuthService(options);
  let id: string | undefined;
  try {
    const email = `smoke-${randomUUID()}@example.invalid`, password = randomBytes(32).toString('base64url');
    const user = await enrollment.api.signUpEmail({ body: { name: 'Synthetic authentication check', email, password } });
    id = user.user.id;
    const ip = `198.51.100.${1 + randomBytes(1)[0] % 253}`;
    const handler = createAuthHandler({ service: () => auth, origin, origins: [origin], clientIp: () => ip });
    const request = (path: string, body: unknown, cookie?: string) => new Request(`${origin}/api/auth/${path}`, {
      method: 'POST', headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
    });
    const signed = await handler(request('sign-in', { email, password })) as Response;
    assert.equal(signed.status, 200);
    const cookies = validatedAuthCookies(signed.headers.getSetCookie(), true);
    assert.ok(cookies.length);
    const loginData = await signed.json(); assert.equal(loginData.user.id, id); assert.ok(!('token' in loginData));
    const cookie = cookies.map((value) => value.split(';')[0]).join('; ');
    const independent = createAuthService(options);
    assert.equal((await independent.api.getSession({ headers: new Headers({ cookie }) }))?.user.id, id);
    const session = await handler(request('session', {}, cookie)) as Response;
    assert.equal((await session.json()).authenticated, true);
    assert.equal((await handler(request('sign-out', {}, cookie)) as Response).status, 200);
    assert.equal(await independent.api.getSession({ headers: new Headers({ cookie }) }), null);
    console.log(JSON.stringify({ operation: 'auth_postgres_smoke', status: 'success', passwordVerified: true, secureCookie: true, sharedSession: true, logoutRevoked: true }));
  } finally {
    try {
      if (id) {
        await pool.query('DELETE FROM tp_auth_session WHERE "userId"=$1', [id]);
        await pool.query('DELETE FROM tp_auth_account WHERE "userId"=$1', [id]);
        await pool.query('DELETE FROM tp_auth_user WHERE id=$1', [id]);
      }
    } finally { await pool.end(); }
  }
}
