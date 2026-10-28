import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuthPool } from '../server/auth/database.ts';

test('Postgres pool configuration preserves verified TLS, strips URL overrides, and redacts idle errors without opening connections', async () => {
  const marker = 'synthetic-private-db-error', before = console.error, logs: string[] = [];
  console.error = value => { logs.push(String(value)); };
  const pool = createAuthPool('postgresql://fixture:synthetic-password@ep-fixture.neon.tech/database?sslmode=no-verify&sslrootcert=private.pem&sslcert=private.crt&sslkey=private.key&sslpassword=private-password&uselibpqcompat=true');
  try {
    assert.deepEqual(pool.options.ssl, { rejectUnauthorized: true }); assert.equal(pool.options.max, 3);
    const url = new URL(pool.options.connectionString!);
    for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'sslpassword', 'uselibpqcompat']) assert.equal(url.searchParams.has(key), false);
    assert.equal(url.username, 'fixture'); assert.equal(url.password, 'synthetic-password');
    assert.ok(pool.options.connectionTimeoutMillis! > 0); assert.ok(pool.options.query_timeout! > 0);
    assert.equal(pool.totalCount, 0); pool.emit('error', Object.assign(new Error(marker), { stack: marker }));
    const event = JSON.parse(logs[0]); assert.equal(event.event, 'auth_storage_failure'); assert.equal(event.code, 'AUTH_UNAVAILABLE');
    assert.ok(!logs.join('').includes(marker)); assert.ok(!logs.join('').includes('synthetic-password'));
    assert.equal(pool.totalCount, 0);
  } finally { await pool.end(); console.error = before; }
  const local = createAuthPool('postgresql://fixture:synthetic-password@localhost/database');
  try { assert.equal(local.options.ssl, false); assert.equal(local.totalCount, 0); } finally { await local.end(); }
});
