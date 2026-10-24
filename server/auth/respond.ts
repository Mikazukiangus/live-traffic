import { config } from '../../config/server.ts';

export const AUTH_NO_STORE = Object.freeze({ 'Cache-Control': 'private, no-store', 'CDN-Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store', Vary: 'Cookie, Origin' });

/** All application cookie writes pass through this reviewed, attribute-validating boundary. */
export function validatedAuthCookies(values: string[], secure = config.server.auth.secureCookies) {
  if (values.length > 8) throw new Error('Invalid authentication cookie');
  for (const value of values) {
    if (value.length > 8192 || /[\r\n]/.test(value) || !/^(?:__Secure-)?trafficpulse\.[a-z0-9_.-]+=/i.test(value) || /;\s*domain=/i.test(value) || !/;\s*httponly(?:;|$)/i.test(value) || !/;\s*samesite=lax(?:;|$)/i.test(value) || !/;\s*path=\/(?:;|$)/i.test(value) || (secure && (!value.startsWith('__Secure-') || !/;\s*secure(?:;|$)/i.test(value)))) throw new Error('Invalid authentication cookie');
  }
  return values;
}

export function authResponse(status: number, body: unknown, cookies: string[] = [], extra: Record<string, string> = {}) {
  const headers = new Headers({ ...AUTH_NO_STORE, ...extra, 'Content-Type': 'application/json' });
  for (const cookie of validatedAuthCookies(cookies)) headers.append('Set-Cookie', cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

export async function sendAuthResponse(response: Response, res?: any) {
  if (!res) return response;
  response.headers.forEach((value, name) => { if (name !== 'set-cookie') res.setHeader(name, value); });
  const values = validatedAuthCookies(response.headers.getSetCookie());
  if (values.length) res.setHeader('Set-Cookie', values);
  res.statusCode = response.status;
  return res.end(await response.text());
}
