import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { logger } from '../shared/logging.ts';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { parseAuthOperatorArgs, authOperatorConnections } from './auth-operator-input.ts';

/** Operator credentials come from an authorized provider/process, never write-only Vercel Secret readback. */
async function run() {
  const { task, prompt: interactive, deployment } = parseAuthOperatorArgs(process.argv.slice(2));
  const link = JSON.parse(readFileSync(new URL('../.vercel/project.json', import.meta.url), 'utf8'));
  const project = 'prj_OaQqagITm0LQjotv9EgoPZOWwjzT', team = 'team_ZEUyUqyAE43B7bGMi6Rdux14';
  if (link.projectId !== project || link.orgId !== team) throw new Error('Unexpected project context');
  if (process.env.VERCEL_ENV === 'production') throw new Error('Production operator target is not allowed');
  if (interactive) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Interactive operator input required');
    let muted = false;
    const output = new Writable({ write(chunk, _encoding, done) { if (!muted) process.stdout.write(chunk); done(); } });
    const input = createInterface({ input: process.stdin, output, terminal: true });
    try {
      for (const [key, label] of [['DATABASE_URL', 'Pooled Neon URL (hidden): '], ['DATABASE_URL_UNPOOLED', 'Direct Neon URL (hidden): ']]) {
        process.stdout.write(label); muted = true;
        process.env[key] = await input.question('');
        muted = false; process.stdout.write('\n');
      }
    } finally { muted = false; input.close(); }
  }
  const connections = authOperatorConnections(process.env);
  process.env.DATABASE_URL = connections.pooled; process.env.DATABASE_URL_UNPOOLED = connections.direct;
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
