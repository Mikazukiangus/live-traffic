import { Pool } from 'pg';
import { attachDatabasePool } from '@vercel/functions';
import { config } from '../../config/server.ts';
import { captureException } from '../../shared/errorTracking.ts';

let pool: Pool | undefined;
export function createAuthPool(connection: string) {
  const url = new URL(connection);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const timeout = config.server.auth.databaseTimeoutMs;
  // pg URL SSL options can override explicit TLS verification; retain only endpoint credentials.
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'sslpassword', 'uselibpqcompat']) url.searchParams.delete(key);
  const created = new Pool({ connectionString: url.toString(), ssl: local ? false : { rejectUnauthorized: true },
    max: 3, connectionTimeoutMillis: timeout, idleTimeoutMillis: 10000, maxLifetimeSeconds: 300,
    query_timeout: timeout, statement_timeout: timeout });
  created.on('error', error => captureException({ event: 'auth_storage_failure', scope: 'auth', code: 'AUTH_UNAVAILABLE' }, error));
  return created;
}
export function authDatabase() {
  if (pool) return pool;
  if (!config.server.auth.databaseUrl) throw new Error('Authentication storage is not configured');
  pool = createAuthPool(config.server.auth.databaseUrl);
  attachDatabasePool(pool);
  return pool;
}
export async function closeAuthDatabase() { const current = pool; pool = undefined; await current?.end(); }
