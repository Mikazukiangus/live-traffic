import { config } from '../../config/server.ts';
import { platformClientIp } from '../http/rateLimit.ts';
import { withRequestDeadline } from '../../shared/requestDeadline.ts';

export class AuthRequestError extends Error {
  constructor(readonly status: number) { super('Authentication request rejected'); }
}
// Session lookup is POST so even a previously installed worker cannot cache account data.
const ROUTES = { session: 'POST', ok: 'GET', 'sign-in': 'POST', 'sign-out': 'POST', 'change-password': 'POST' } as const;
export type AuthRoute = keyof typeof ROUTES;

function parsedUrl(req: any) { return new URL(req.url, config.server.auth.origin); }
export function isAuthTransport(req: any) {
  try { const u = parsedUrl(req); return u.pathname.startsWith('/api/auth') || u.searchParams.getAll('feed').includes('auth') || req.query?.feed === 'auth'; }
  catch { return false; }
}

export function authRoute(req: any): AuthRoute {
  const url = parsedUrl(req);
  let params = url.searchParams;
  let route: string;
  if (url.pathname.startsWith('/api/auth/')) {
    route = url.pathname.slice('/api/auth/'.length);
    // Vercel can retain the public pathname while appending its rewrite controls.
    if (params.size && (params.size !== 2 || params.getAll('feed').length !== 1 || params.get('feed') !== 'auth' || params.getAll('authPath').length !== 1 || params.get('authPath') !== route))
      throw new AuthRequestError(400);
  } else {
    // Node adapters may expose rewrite controls in req.query rather than req.url.
    // Never replace URL parameters or collapse duplicate/array values.
    if (!params.size && req.query && typeof req.query === 'object') {
      params = new URLSearchParams();
      for (const [key, value] of Object.entries(req.query)) {
        if (typeof value !== 'string') throw new AuthRequestError(400);
        params.append(key, value);
      }
    }
    if (![...params.keys()].every((key) => key === 'feed' || key === 'authPath') || params.getAll('feed').length !== 1 || params.get('feed') !== 'auth' || params.getAll('authPath').length !== 1)
      throw new AuthRequestError(400);
    route = params.get('authPath')!;
  }
  if (!Object.hasOwn(ROUTES, route)) throw new AuthRequestError(404);
  if (req.method !== ROUTES[route as AuthRoute]) throw new AuthRequestError(405);
  return route as AuthRoute;
}

/** Only platform-overwritten IP metadata or the actual local TCP peer is trusted. */
export function authClientIp(req: any) {
  if (config.server.rateLimit.platform) return platformClientIp(req);
  const address = req.socket?.remoteAddress;
  if (config.server.allowLoopbackHttp && typeof address === 'string') return platformClientIp({ headers: { 'x-real-ip': address } });
  throw new AuthRequestError(503);
}

export function validateAuthOrigin(headers: Headers, method: string, allowed: readonly string[]) {
  const origin = headers.get('origin');
  if (headers.get('sec-fetch-site') === 'cross-site' || (origin !== null && !allowed.includes(origin)) || (method === 'POST' && origin === null))
    throw new AuthRequestError(403);
}

/** Rebuild canonical JSON after a bounded read; no callback, role, or redirect input is accepted. */
export async function authBody(req: any, route: AuthRoute, headers: Headers): Promise<Record<string, unknown>> {
  if (req.method !== 'POST') {
    if (!(req instanceof Request) && req.body !== undefined && req.body !== null && req.body !== '') throw new AuthRequestError(400);
    if (headers.has('transfer-encoding') || (headers.get('content-length') !== null && headers.get('content-length') !== '0')) throw new AuthRequestError(400);
    return {};
  }
  if (headers.has('content-encoding') || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(headers.get('content-type') ?? '')) throw new AuthRequestError(415);
  const length = headers.get('content-length');
  if (length !== null && (!/^\d{1,5}$/.test(length) || Number(length) > 4096)) throw new AuthRequestError(413);
  let raw: string;
  if (req instanceof Request) {
    raw = await withRequestDeadline(5000, async (signal) => {
      const reader = req.body?.getReader(); if (!reader) return '{}';
      const chunks: Uint8Array[] = []; let total = 0;
      const cancel = () => { void reader.cancel().catch(() => {}); };
      signal.addEventListener('abort', cancel, { once: true });
      try {
        while (true) { const item = await reader.read(); signal.throwIfAborted(); if (item.done) break;
          total += item.value.byteLength; if (total > 4096) { cancel(); throw new AuthRequestError(413); } chunks.push(item.value); }
        return Buffer.concat(chunks).toString('utf8') || '{}';
      } finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
    }, req.signal);
  } else if (req.body !== undefined) raw = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body);
  else {
    raw = await withRequestDeadline(5000, (signal) => new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = []; let total = 0;
      const done = (error?: unknown) => { req.removeListener('data', data); req.removeListener('end', end); req.removeListener('error', fail); signal.removeEventListener('abort', abort); if (error) reject(error); else resolve(Buffer.concat(chunks).toString('utf8') || '{}'); };
      const data = (chunk: Buffer) => { total += chunk.length; if (total > 4096) { req.pause(); done(new AuthRequestError(413)); } else chunks.push(chunk); };
      const end = () => done(); const fail = () => done(new AuthRequestError(400)); const abort = () => { req.pause(); done(new AuthRequestError(408)); };
      req.on('data', data); req.once('end', end); req.once('error', fail); signal.addEventListener('abort', abort, { once: true });
    }));
  }
  if (typeof raw !== 'string') throw new AuthRequestError(400);
  if (Buffer.byteLength(raw) > 4096) throw new AuthRequestError(413);
  let value: any; try { value = JSON.parse(raw); } catch { throw new AuthRequestError(400); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AuthRequestError(400);
  const allowed = route === 'sign-in' ? ['email', 'password'] : route === 'change-password' ? ['currentPassword', 'newPassword'] : [];
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new AuthRequestError(400);
  if (route === 'sign-in') {
    if (typeof value.email !== 'string' || value.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) throw new AuthRequestError(400);
    if (typeof value.password !== 'string' || value.password.length < 1 || value.password.length > 128) throw new AuthRequestError(400);
    return { email: value.email.toLowerCase(), password: value.password, rememberMe: true };
  }
  if (route === 'change-password') {
    if (typeof value.currentPassword !== 'string' || value.currentPassword.length < 1 || value.currentPassword.length > 128 || typeof value.newPassword !== 'string' || value.newPassword.length < 12 || value.newPassword.length > 128) throw new AuthRequestError(400);
    return { currentPassword: value.currentPassword, newPassword: value.newPassword, revokeOtherSessions: true };
  }
  return {};
}
