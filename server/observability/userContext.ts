import { config } from '../../config/server.ts';
import { withRequestDeadline } from '../../shared/requestDeadline.ts';
import { setAnonymousLogUser, setVerifiedLogUser, resolveLogUserOnce } from './context.ts';
import { headerValues } from '../http/requestSchemas.ts';

export function createLogUserResolver(options: {
  enabled: boolean; secret: string | null; timeoutMs: number;
  verify: (headers: Headers) => Promise<{ user: { id: string } } | null>;
}) {
  return (req: any) => resolveLogUserOnce(req, async () => {
    if (!options.enabled) { setAnonymousLogUser(); return; }
    const headers = new Headers();
    // Cookies go only to the verifier. No header/query/body identity is ever logged or trusted.
    const cookies = headerValues(req, 'cookie');
    if (cookies.length > 1) throw new Error('User context unavailable');
    const cookie = cookies[0];
    if (Array.isArray(req.rawHeaders)) {
      const raw: unknown[] = [];
      for (let i = 0; i < req.rawHeaders.length; i += 2) if (String(req.rawHeaders[i]).toLowerCase() === 'cookie') raw.push(req.rawHeaders[i + 1]);
      if (raw.length > 1 || (raw.length === 1 && raw[0] !== cookie)) throw new Error('User context unavailable');
    }
    if (cookie && cookie.length > 8192) throw new Error('User context unavailable');
    if (typeof cookie !== 'string' || !/(?:^|;\s*)(?:__Secure-)?trafficpulse\.session_token=/.test(cookie)) {
      setAnonymousLogUser(); return;
    }
    if (!options.secret || options.secret.length < 32) throw new Error('User context unavailable');
    headers.set('cookie', cookie);
    // Resolve to a value first. Late verifier completion after timeout cannot mutate request context.
    const session = await withRequestDeadline(options.timeoutMs, () => options.verify(headers), req instanceof Request ? req.signal : undefined);
    if (session === null) { setAnonymousLogUser(); return; }
    const id = session?.user?.id;
    if (typeof id !== 'string' || !id || id.length > 512) throw new Error('User context unavailable');
    setVerifiedLogUser(id, options.secret);
  });
}

export const resolveRequestLogUser = createLogUserResolver({ enabled: config.server.auth.enabled,
  secret: config.server.auth.secret, timeoutMs: config.server.logging.userContextTimeoutMs,
  verify: async headers => {
    const { getAuthService } = await import('../auth/service.ts');
    const service = getAuthService(); if (!service) throw new Error('User context unavailable');
    return service.api.getSession({ headers, query: { disableCookieCache: true } });
  },
});
