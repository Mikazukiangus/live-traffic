import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { logger } from '../shared/logging.ts';

/** Narrow operator bootstrap: only two explicitly selected development DB settings enter memory. */
async function run() {
  const [task, databaseId, directId, deployment] = process.argv.slice(2);
  if (!['migrate', 'smoke', 'preview-smoke', 'create-user'].includes(task) || !/^[a-zA-Z0-9_-]{5,80}$/.test(databaseId ?? '') || !/^[a-zA-Z0-9_-]{5,80}$/.test(directId ?? '')) throw new Error('Invalid operator arguments');
  const link = JSON.parse(readFileSync(new URL('../.vercel/project.json', import.meta.url), 'utf8'));
  const project = 'prj_OaQqagITm0LQjotv9EgoPZOWwjzT', team = 'team_ZEUyUqyAE43B7bGMi6Rdux14';
  if (link.projectId !== project || link.orgId !== team) throw new Error('Unexpected project context');
  for (const [key, id] of [['DATABASE_URL', databaseId], ['DATABASE_URL_UNPOOLED', directId]]) {
    const path = `/v1/projects/${project}/env/${id}?teamId=${team}`;
    const result = spawnSync('bunx', ['vercel@65.2.0', '--scope', team, 'api', path, '--method', 'GET'], {
      cwd: new URL('../', import.meta.url), encoding: 'utf8', stdio: 'pipe', timeout: 20000,
    });
    if (result.status !== 0) throw new Error('Database setting lookup failed');
    let data = JSON.parse(result.stdout); while (data.result) data = data.result;
    if (data.key !== key || !Array.isArray(data.target) || !data.target.includes('development') || typeof data.value !== 'string') throw new Error('Unexpected database setting');
    const url = new URL(data.value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname.endsWith('.neon.tech')) throw new Error('Unexpected database destination');
    process.env[key] = data.value;
  }
  process.env.NODE_ENV = 'development';
  process.env.AUTH_ENABLED = 'false'; process.env.VITE_AUTH_ENABLED = 'false';
  process.env.BETTER_AUTH_SECRET = randomBytes(48).toString('base64url');
  if (task === 'migrate') await (await import('./auth-migrate.ts')).migrateAuth();
  else if (task === 'smoke') await (await import('./auth-smoke.ts')).smokeAuth();
  else if (task === 'preview-smoke') await (await import('./auth-preview-smoke.ts')).smokePreview(deployment);
  else await (await import('./auth-create-user.ts')).createAccount();
}
void run().catch(() => {
  logger.error({ event: 'auth_operator', operation: 'auth_database_task', status: 'failed', code: 'AUTH_BOOTSTRAP_FAILED' }); process.exitCode = 1;
});
