import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getMigrations } from 'better-auth/db/migration';
import { config } from '../config/server.ts';
import { createAuthPool } from '../server/auth/database.ts';
import { createAuthService } from '../server/auth/service.ts';
import { logger } from '../server/observability/context.ts';

/** Operator-only. Environment stays in the subprocess; no connection/secret is exported. */
export async function migrateAuth() {
  if (!config.server.auth.directDatabaseUrl) throw new Error('Authentication migration settings missing');
  const pool = createAuthPool(config.server.auth.directDatabaseUrl);
  try {
    // Schema inspection does not create sessions or require the deployed signing secret.
    const auth = createAuthService({ database: pool, secret: randomBytes(48).toString('base64url'), origin: config.server.auth.origin, secureCookies: config.server.auth.secureCookies });
    const plan = await getMigrations(auth.options);
    if (plan.unsafeChanges.length || plan.schemaProblems.length) throw new Error('Authentication migration needs review');
    await plan.runMigrations();
    await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS tp_auth_account_identity ON tp_auth_account ("providerId", "accountId")');
    await pool.query('CREATE INDEX IF NOT EXISTS tp_auth_session_expiry ON tp_auth_session ("expiresAt")');
    await pool.query('CREATE INDEX IF NOT EXISTS tp_auth_rate_limit_expiry ON tp_auth_rate_limit ("lastRequest")');
    logger.info({ event: 'auth_operator', operation: 'auth_migration', status: 'success', tablesCreated: plan.toBeCreated.length, columnsAdded: plan.toBeAdded.length });
  } finally { await pool.end(); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) void migrateAuth().catch(() => {
  logger.error({ event: 'auth_operator', operation: 'auth_migration', status: 'failed', code: 'AUTH_MIGRATION_FAILED' }); process.exitCode = 1;
});
