import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { config } from '../config/server.ts';
import { createAuthPool } from '../server/auth/database.ts';
import { createAuthService } from '../server/auth/service.ts';
import { validatedAuthCookies } from '../server/auth/respond.ts';

/** Selected protected preview only. Passwords/cookies use stdin and captured memory, never argv/files/output. */
export async function smokePreview(deployment: string) {
  const url = new URL(deployment);
  assert.match(url.hostname, /^live-traffic-[a-z0-9]+-carbon-bc04\.vercel\.app$/);
  assert.equal(url.origin, deployment); assert.equal(url.protocol, 'https:');
  const metadata = spawnSync('bunx', ['vercel@65.2.0', '--scope', 'carbon-bc04', 'api',
    `/v13/deployments/${url.hostname}?teamId=team_ZEUyUqyAE43B7bGMi6Rdux14`, '--method', 'GET'],
  { encoding: 'utf8', stdio: 'pipe', timeout: 20000 });
  assert.equal(metadata.status, 0);
  const detail = JSON.parse(metadata.stdout);
  assert.equal(detail.projectId ?? detail.project?.id, 'prj_OaQqagITm0LQjotv9EgoPZOWwjzT');
  assert.equal(detail.meta.githubCommitRef, 'codex/public-api-rate-limits');
  assert.notEqual(detail.target, 'production'); assert.equal(detail.readyState, 'READY');

  function call(path: string, body: unknown, cookie?: string) {
    const curlConfig = ['silent', 'show-error', 'include', 'max-time = 25', 'request = "POST"',
      `header = ${JSON.stringify('Origin: ' + deployment)}`, 'header = "Content-Type: application/json"',
      ...(cookie ? [`header = ${JSON.stringify('Cookie: ' + cookie)}`] : []),
      `data = ${JSON.stringify(JSON.stringify(body))}`].join('\n');
    const result = spawnSync('bunx', ['vercel@65.2.0', '--scope', 'carbon-bc04', 'curl', path,
      '--deployment', detail.id, '--', '--config', '-'],
    { input: curlConfig, encoding: 'utf8', stdio: 'pipe', timeout: 45000, maxBuffer: 1024 * 1024 });
    assert.equal(result.status, 0, 'Preview request failed');
    // curl can emit a proxy CONNECT header block before the actual response.
    const starts = [...result.stdout.matchAll(/(?:^|\r?\n)HTTP\/[^\r\n]+/g)];
    const raw = result.stdout.slice(starts.at(-1)?.index ?? 0).trimStart();
    const split = raw.search(/\r?\n\r?\n/); assert.ok(split >= 0, 'Missing response headers');
    const headers = raw.slice(0, split), payload = raw.slice(split).trim();
    const status = Number(headers.match(/^HTTP\/\S+ (\d{3})/)?.[1]);
    assert.match(headers, /cache-control:.*no-store/i);
    return { status, headers, body: JSON.parse(payload), cookies: headers.split(/\r?\n/)
      .filter(line => /^set-cookie:/i.test(line)).map(line => line.slice(line.indexOf(':') + 1).trim()) };
  }

  const pool = createAuthPool(config.server.auth.databaseUrl!);
  const enrollment = createAuthService({ database: pool, secret: config.server.auth.secret!, origin: deployment,
    secureCookies: true, allowEnrollment: true });
  let id: string | undefined;
  try {
    const email = `preview-smoke-${randomUUID()}@example.invalid`, password = randomBytes(32).toString('base64url');
    id = (await enrollment.api.signUpEmail({ body: { name: 'Synthetic preview check', email, password } })).user.id;
    const anonymous = call('/api/auth/session', {}); assert.equal(anonymous.status, 200); assert.equal(anonymous.body.authenticated, false);
    const signed = call('/api/auth/sign-in', { email, password }); assert.equal(signed.status, 200, 'Preview sign-in failed');
    assert.equal(signed.body.user.id, id); assert.ok(!('token' in signed.body));
    const cookies = validatedAuthCookies(signed.cookies, true); assert.ok(cookies.length);
    const cookie = cookies.map(value => value.split(';')[0]).join('; ');
    const session = call('/api/auth/session', {}, cookie); assert.equal(session.status, 200); assert.equal(session.body.user.id, id);
    // A read-only invalid feed request traverses account admission without provider work.
    const admission = call('/api/rainforecast?limit=0', {}, cookie); assert.equal(admission.status, 405);
    const logout = call('/api/auth/sign-out', {}, cookie); assert.equal(logout.status, 200);
    const revoked = call('/api/auth/session', {}, cookie); assert.equal(revoked.status, 200); assert.equal(revoked.body.authenticated, false);
    console.log(JSON.stringify({ operation: 'auth_preview_smoke', status: 'success', signIn: true,
      secureCookie: true, sessionRead: true, logoutRevoked: true, accountAdmissionTraversed: true,
      quotaEnforced: false }));
  } finally {
    try { if (id) {
      await pool.query('DELETE FROM tp_auth_session WHERE "userId"=$1', [id]);
      await pool.query('DELETE FROM tp_auth_account WHERE "userId"=$1', [id]);
      await pool.query('DELETE FROM tp_auth_user WHERE id=$1', [id]);
    } } finally { await pool.end(); }
  }
}
