import { fromNodeHeaders } from 'better-auth/node';
import { config } from '../../config/server.ts';
import { withRequestDeadline } from '../../shared/requestDeadline.ts';
import { getAuthService, authHeaders, type createAuthService } from './service.ts';
import { authBody, authRoute, AuthRequestError, authClientIp, validateAuthOrigin } from './request.ts';
import { authResponse, sendAuthResponse } from './respond.ts';
import { withErrorContext } from '../observability/context.ts';
import { captureException } from '../../shared/errorTracking.ts';

export function publicUser(user: any) {
  if (!user || typeof user.id !== 'string' || typeof user.name !== 'string' || typeof user.email !== 'string') throw new Error('Invalid authentication response');
  return { id: user.id, name: user.name, email: user.email };
}

export function createAuthHandler(options: { service: () => ReturnType<typeof createAuthService> | null;
  origin: string; origins: readonly string[]; clientIp?: (req: any) => string }) {
  const handler = async (req: any, res?: any) => {
    let response: Response;
    try {
      const route = authRoute(req);
      const headers = req.headers instanceof Headers ? req.headers : fromNodeHeaders(req.headers ?? {});
      validateAuthOrigin(headers, req.method, options.origins);
      const body = await authBody(req, route, headers);
      const service = options.service();
      if (!service) return sendAuthResponse(authResponse(503, { success: false, code: 'AUTH_NOT_CONFIGURED', error: 'Sign-in is not available yet.' }), res);
      const safe = authHeaders(headers);
      safe.set('x-real-ip', (options.clientIp ?? authClientIp)(req));
      const path = { session: 'get-session', ok: 'ok', 'sign-in': 'sign-in/email', 'sign-out': 'sign-out', 'change-password': 'change-password' }[route];
      const libraryMethod = route === 'session' ? 'GET' : req.method;
      const request = new Request(`${options.origin}/api/auth/${path}`, { method: libraryMethod, headers: safe,
        ...(libraryMethod === 'POST' ? { body: JSON.stringify(body) } : {}) });
      const result = await withRequestDeadline(config.server.auth.requestTimeoutMs, () => service.handler(request));
      const cookies = result.headers.getSetCookie();
      if (!result.ok) {
        const status = [400, 401, 403, 429].includes(result.status) ? result.status : 503;
        const event = status === 503 ? captureException({ event: 'authentication_unavailable', scope: 'auth', code: 'AUTH_UNAVAILABLE' }, undefined, true) : null;
        const retry = result.headers.get('retry-after') ?? result.headers.get('x-retry-after');
        response = authResponse(status, { success: false, code: status === 429 ? 'AUTH_RATE_LIMITED' : status === 503 ? 'AUTH_UNAVAILABLE' : 'AUTH_REJECTED',
          error: status === 429 ? 'Too many attempts. Please try again later.' : status === 503 ? 'Sign-in is temporarily unavailable.' : 'Unable to complete sign-in. Check your details and try again.', ...(event ? { errorId: event.errorId } : {}) }, cookies,
          status === 429 && retry && /^\d{1,5}$/.test(retry) ? { 'Retry-After': retry } : {});
      } else if (route === 'session') {
        const data = await result.json();
        response = authResponse(200, data?.user ? { authenticated: true, user: publicUser(data.user) } : { authenticated: false }, cookies);
      } else if (route === 'sign-in') {
        const data = await result.json();
        response = authResponse(200, { success: true, user: publicUser(data.user) }, cookies);
      } else response = authResponse(200, { success: true }, cookies);
    } catch (error) {
      const status = error instanceof AuthRequestError ? error.status : 503;
      const event = status === 503 ? captureException({ event: 'authentication_unavailable', scope: 'auth', code: 'AUTH_UNAVAILABLE' }, error, true) : null;
      response = authResponse(status, { success: false, code: status === 503 ? 'AUTH_UNAVAILABLE' : 'INVALID_AUTH_REQUEST',
        error: status === 503 ? 'Sign-in is temporarily unavailable.' : 'Invalid authentication request.', ...(event ? { errorId: event.errorId } : {}) });
    }
    return sendAuthResponse(response, res);
  };
  return (req: any, res?: any) => withErrorContext(req, () => handler(req, res));
}

export const authHandler = createAuthHandler({ service: getAuthService, origin: config.server.auth.origin, origins: config.server.auth.origins });
