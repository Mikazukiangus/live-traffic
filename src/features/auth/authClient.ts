import { fetchWithTimeout } from '../../utils/request';

export type AccountUser = { id: string; name: string; email: string };
export class AccountError extends Error {
  constructor(readonly status: number, readonly retryAfter: number | null = null) {
    super(status === 429 ? 'Too many attempts. Please try again later.' : status === 401 || status === 403 ? 'Check your email and password, then try again.' : 'Sign-in is temporarily unavailable. Please try again.');
  }
}
export function accountUser(value: unknown): AccountUser {
  const user = value as AccountUser;
  if (!user || typeof user.id !== 'string' || !user.id || user.id.length > 512 || typeof user.name !== 'string' || user.name.length > 200 || typeof user.email !== 'string' || user.email.length > 254) throw new AccountError(503);
  return { id: user.id, name: user.name, email: user.email };
}
export async function accountRequest(route: 'session' | 'sign-in' | 'sign-out' | 'change-password', body?: Record<string, string>, signal?: AbortSignal) {
  return fetchWithTimeout(`/api/auth/${route}`, async (response) => {
    if (!response.ok) {
      const raw = response.headers.get('retry-after');
      const retry = raw && /^\d{1,5}$/.test(raw) ? Math.min(900, Number(raw)) : null;
      await response.body?.cancel();
      throw new AccountError(response.status, retry);
    }
    const data = await response.json();
    if (!data || typeof data !== 'object') throw new AccountError(503);
    return data;
  }, { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) }, 20000);
}
