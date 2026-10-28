import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { hash, verify } from '@node-rs/argon2';
import type { Pool } from 'pg';
import { config } from '../../config/server.ts';
import { authDatabase } from './database.ts';
import { captureException } from '../../shared/errorTracking.ts';

export const AUTH_COOKIE_PREFIX = 'trafficpulse';
export const PASSWORD_POLICY = Object.freeze({ minimum: 12, maximum: 128,
  algorithm: 2 as const, version: 1 as const, memoryCost: 65536, timeCost: 3, parallelism: 1, outputLen: 32 });

/** Factory also supports isolated integration tests and the operator-only enrollment script. */
export function createAuthService(options: { database: BetterAuthOptions['database']; secret: string; origin: string;
  secureCookies: boolean; allowEnrollment?: boolean; trustedOrigins?: readonly string[] }) {
  return betterAuth({
    appName: 'TrafficPulse', baseURL: options.origin, basePath: '/api/auth', secret: options.secret,
    trustedOrigins: [...(options.trustedOrigins ?? [options.origin])], database: options.database,
    user: { modelName: 'tp_auth_user', changeEmail: { enabled: false }, deleteUser: { enabled: false } },
    account: { modelName: 'tp_auth_account', accountLinking: { enabled: false } },
    verification: { modelName: 'tp_auth_verification' },
    session: { modelName: 'tp_auth_session', expiresIn: 86400, updateAge: 3600, cookieCache: { enabled: false } },
    emailAndPassword: { enabled: true, disableSignUp: !options.allowEnrollment,
      autoSignIn: false,
      minPasswordLength: PASSWORD_POLICY.minimum, maxPasswordLength: PASSWORD_POLICY.maximum,
      password: { hash: (password) => hash(password, PASSWORD_POLICY), verify: ({ password, hash: encoded }) => verify(encoded, password) },
      revokeSessionsOnPasswordReset: true },
    advanced: { cookiePrefix: AUTH_COOKIE_PREFIX, useSecureCookies: options.secureCookies,
      defaultCookieAttributes: { httpOnly: true, secure: options.secureCookies, sameSite: 'lax', path: '/' },
      ipAddress: { ipAddressHeaders: ['x-real-ip'], ipv6Subnet: 64 } },
    // v1.7 uses atomic conditional increments/unique keys in database mode, shared by all instances.
    rateLimit: { enabled: true, storage: 'database', modelName: 'tp_auth_rate_limit', window: 60, max: 30,
      customRules: { '/sign-in/email': { window: 900, max: 5 }, '/change-password': { window: 900, max: 5 } } },
    logger: { level: 'warn', log: () => captureException({ event: 'authentication_event', scope: 'auth', code: 'AUTH_EVENT' }, undefined, true) },
  });
}

let service: ReturnType<typeof createAuthService> | undefined;
export function getAuthService() {
  if (!config.server.auth.enabled) return null;
  return service ??= createAuthService({ database: authDatabase() as Pool, secret: config.server.auth.secret!,
    origin: config.server.auth.origin, secureCookies: config.server.auth.secureCookies, trustedOrigins: config.server.auth.origins });
}

/** Cookie presence only selects whether verification is needed. It never proves identity. */
export function hasAuthCookie(headers: Headers) {
  const value = headers.get('cookie') ?? '';
  return /(?:^|;\s*)(?:__Secure-)?trafficpulse\.session_token=/.test(value);
}
export function authHeaders(headers: Headers) {
  const safe = new Headers();
  for (const key of ['cookie', 'origin', 'content-type', 'sec-fetch-site', 'x-real-ip']) {
    const value = headers.get(key); if (value !== null) safe.set(key, value);
  }
  return safe;
}
