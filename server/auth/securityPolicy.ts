import { createHmac } from 'node:crypto';
import type { BetterAuthPlugin, DBAdapter, RateLimit } from 'better-auth/types';
import { APIError, createAuthMiddleware, isAPIError } from 'better-auth/api';
import { deleteSessionCookie } from 'better-auth/cookies';
import { captureException } from '../../shared/errorTracking.ts';

export const AUTH_SECURITY = Object.freeze({ accountAttempts: 10, accountWindowSeconds: 900, absoluteSessionSeconds: 86400 });
const expiredByAge = (createdAt: unknown) => {
  const created = new Date(createdAt as string | number | Date).getTime(), now = Date.now();
  return !Number.isFinite(created) || created > now || now - created >= AUTH_SECURITY.absoluteSessionSeconds * 1000;
};

/** Reuse Better Auth's unique-key table and atomic adapter primitive, never a per-instance Map.
 * Reservations precede password hashing, so concurrent failures cannot overshoot the budget.
 * Successes also count; neither success nor a blocked attempt extends the fixed cooldown.
 */
async function admitAccount(db: DBAdapter, secret: string, email: string) {
  const key = `account-v1:${createHmac('sha256', secret).update(email.toLowerCase()).digest('hex')}`;
  const windowMs = AUTH_SECURITY.accountWindowSeconds * 1000;
  for (let attempt = 0; attempt < 8; attempt++) {
    const row = await db.findOne<RateLimit>({ model: 'rateLimit', where: [{ field: 'key', value: key }] });
    const now = Date.now();
    if (!row) {
      try {
        await db.create({ model: 'rateLimit', data: { key, count: 1, lastRequest: now } });
        return;
      } catch (error) {
        // Recover only a competing unique-key insert; storage failures fail closed.
        if (!await db.findOne({ model: 'rateLimit', where: [{ field: 'key', value: key }] })) throw error;
        continue;
      }
    }
    const started = Number(row.lastRequest);
    if (!Number.isSafeInteger(started) || started > now || !Number.isSafeInteger(row.count) || row.count < 1)
      throw new Error('Account admission unavailable');
    if (now - started >= windowMs) {
      if (await db.incrementOne({ model: 'rateLimit', where: [{ field: 'key', value: key },
        { field: 'lastRequest', value: row.lastRequest }, { field: 'count', value: row.count }],
        increment: {}, set: { count: 1, lastRequest: now } })) return;
      continue;
    }
    if (row.count >= AUTH_SECURITY.accountAttempts) throw new APIError('TOO_MANY_REQUESTS',
      { code: 'AUTH_RATE_LIMITED', message: 'Too many attempts. Please try again later.' },
      { 'Retry-After': String(Math.max(1, Math.ceil((started + windowMs - now) / 1000))) });
    if (await db.incrementOne({ model: 'rateLimit', where: [{ field: 'key', value: key },
      { field: 'lastRequest', value: row.lastRequest }, { field: 'count', operator: 'lt', value: AUTH_SECURITY.accountAttempts }],
      increment: { count: 1 } })) return;
  }
  throw new Error('Account admission unavailable');
}

/** Hook the library before its best-effort logout, without patching library internals or exposing new routes. */
export function authSecurityPolicy(): BetterAuthPlugin {
  return { id: 'trafficpulse-auth-security', hooks: { before: [{
    matcher: ctx => ['/sign-in/email', '/sign-out', '/change-password', '/revoke-session', '/revoke-sessions', '/revoke-other-sessions'].includes(ctx.path ?? ''),
    handler: createAuthMiddleware(async ctx => {
      try {
        if (ctx.path === '/sign-in/email') {
          if (typeof ctx.body?.email === 'string' && ctx.body.email.length <= 254)
            await admitAccount(ctx.context.adapter, ctx.context.secret, ctx.body.email);
          return;
        }
        const token = await ctx.getSignedCookie(ctx.context.authCookies.sessionToken.name, ctx.context.secret);
        if (!token) return;
        if (ctx.path === '/sign-out') {
          // Unlike the library's best-effort sign-out, a failed authoritative delete propagates.
          await ctx.context.internalAdapter.deleteSession(token);
          return;
        }
        const found = await ctx.context.internalAdapter.findSession(token);
        if (!found) return;
        if (expiredByAge(found.session.createdAt)) {
          deleteSessionCookie(ctx);
          throw new APIError('UNAUTHORIZED', { code: 'UNAUTHORIZED', message: 'Unauthorized' });
        }
      } catch (error) {
        if (isAPIError(error)) throw error;
        captureException({ event: 'authentication_unavailable', scope: 'auth', code: 'AUTH_UNAVAILABLE' }, error, true);
        // Do not let the underlying router print a raw adapter exception.
        throw new APIError('SERVICE_UNAVAILABLE', { code: 'AUTH_UNAVAILABLE', message: 'Authentication temporarily unavailable.' });
      }
    }),
  }], after: [{
    matcher: ctx => ctx.path === '/get-session',
    handler: createAuthMiddleware(async ctx => {
      const found = ctx.context.returned as { session?: { createdAt?: unknown } } | null;
      if (found?.session && expiredByAge(found.session.createdAt)) {
        // An after hook can replace a successful session with null without a DB write.
        deleteSessionCookie(ctx);
        return ctx.json(null);
      }
    }),
  }] } };
}
