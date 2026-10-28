import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { config } from '../config/server.ts';
import { createAuthPool } from '../server/auth/database.ts';
import { createAuthService } from '../server/auth/service.ts';
import { logger } from '../server/observability/context.ts';

/** Human operator only: never accept a password in a command argument, source or chat. */
export async function createAccount() {
  if (!process.stdin.isTTY || !process.stdout.isTTY || !config.server.auth.databaseUrl || !config.server.auth.secret) throw new Error('Interactive operator enrollment required');
  let muted = false;
  const output = new Writable({ write(chunk, _encoding, done) { if (!muted) process.stdout.write(chunk); done(); } });
  const prompt = createInterface({ input: process.stdin, output, terminal: true });
  let pool: ReturnType<typeof createAuthPool> | undefined;
  try {
    const name = (await prompt.question('Name: ')).trim();
    const email = (await prompt.question('Email: ')).trim().toLowerCase();
    process.stdout.write('Password (hidden): '); muted = true;
    const password = await prompt.question(''); muted = false; process.stdout.write('\n');
    process.stdout.write('Confirm password (hidden): '); muted = true;
    const confirmed = await prompt.question(''); muted = false; process.stdout.write('\n');
    if (!name || name.length > 200 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password !== confirmed || password.length < 12 || password.length > 128) throw new Error('Invalid account enrollment');
    pool = createAuthPool(config.server.auth.databaseUrl);
    const auth = createAuthService({ database: pool, secret: config.server.auth.secret, origin: config.server.auth.origin, secureCookies: config.server.auth.secureCookies, allowEnrollment: true });
    await auth.api.signUpEmail({ body: { name, email, password } });
    logger.info({ event: 'auth_operator', operation: 'account_created', status: 'success' });
  } finally { muted = false; prompt.close(); await pool?.end(); }
}
