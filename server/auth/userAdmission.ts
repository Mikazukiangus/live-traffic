import { config } from '../../config/server.ts';
import { API_RATE_LIMITS } from '../../config/rateLimitPolicy.ts';
import { withRequestDeadline } from '../../shared/requestDeadline.ts';
import { authHeaders, getAuthService, hasAuthCookie } from './service.ts';
import { isAuthTransport } from './request.ts';
import { authResponse } from './respond.ts';
import { corsHeaders, setWebCors } from '../http/cors.ts';
import { RequestValidationError } from '../http/requestSchemas.ts';
import { platformClientIp, rateLimitBucket, RateLimitRejection, vercelRateLimitCheck, type RateLimitCheck } from '../http/rateLimit.ts';

/** Runs before CDN lookup. A cached public body is safe only after this per-request admission. */
export function createUserAdmission(options: {
  enabled: boolean; mode: 'off' | 'observe' | 'enforce'; host: string; namespace: string;
  verify: (headers: Headers) => Promise<{ user: { id: string } } | null>;
  check?: RateLimitCheck; timeoutMs?: number; verifierTimeoutMs?: number;
}) {
  let nextWarning = 0;
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);
    if (!options.enabled || options.mode === 'off' || !url.pathname.startsWith('/api/') || isAuthTransport(request) || request.method === 'OPTIONS' || !hasAuthCookie(request.headers)) return null;
    let headers: Record<string, string> = { Vary: 'Origin' };
    try {
      headers = corsHeaders(request);
      const session = await withRequestDeadline(options.verifierTimeoutMs ?? 10000, () => options.verify(authHeaders(request.headers)), request.signal);
      if (session === null) return null; // Revoked/invalid sessions are anonymous; IP protection still applies.
      const id = session?.user?.id;
      if (typeof id !== 'string' || !id || id.length > 512 || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.vercel\.app$/.test(options.host)) throw new RateLimitRejection(503);
      const ip = platformClientIp(request);
      const timeoutMs = options.timeoutMs ?? 1000;
      const result = await withRequestDeadline(timeoutMs, () => (options.check ?? vercelRateLimitCheck)({
        id: API_RATE_LIMITS.id, key: rateLimitBucket(options.namespace, 'user', id), ip, host: options.host, timeoutMs,
      }), request.signal);
      if (!result || typeof result.rateLimited !== 'boolean' || result.error) throw new RateLimitRejection(503);
      if (result.rateLimited) throw new RateLimitRejection(429);
      return null;
    } catch (error) {
      if (error instanceof RequestValidationError) return setWebCors(authResponse(403, { success: false, code: 'CORS_ORIGIN_DENIED', error: 'Cross-origin request denied.' }), headers);
      const failure = error instanceof RateLimitRejection ? error : new RateLimitRejection(503);
      if (Date.now() >= nextWarning) { nextWarning = Date.now() + 60000; console.warn(JSON.stringify({ event: 'user_rate_limit', code: failure.code })); }
      if (options.mode === 'observe') return null;
      return setWebCors(authResponse(failure.status, { success: false, code: failure.code,
        error: failure.status === 429 ? 'Too many requests. Please try again shortly.' : 'Service temporarily unavailable. Please try again shortly.' }, [],
        { 'Retry-After': String(failure.retryAfter), 'Access-Control-Expose-Headers': 'Retry-After' }), headers);
    }
  };
}

export const userAdmission = createUserAdmission({ enabled: config.server.auth.enabled && config.server.rateLimit.platform,
  mode: config.server.rateLimit.mode, host: config.server.rateLimit.host, namespace: config.server.rateLimit.namespace,
  timeoutMs: config.server.rateLimit.timeoutMs, verifierTimeoutMs: config.server.auth.requestTimeoutMs,
  verify: async (headers) => {
    const auth = getAuthService(); if (!auth) throw new RateLimitRejection(503);
    return auth.api.getSession({ headers, query: { disableCookieCache: true } });
  },
});
