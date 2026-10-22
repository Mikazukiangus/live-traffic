import { retryAfterMs } from '../../shared/httpRetry';
import { fetchWithTimeout } from './request';

/** Fixed status text and parsed timing only; never keep a response body or raw header in errors. */
export class FeedHttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryAt: number | null,
  ) {
    super(`HTTP ${status}`);
  }
}
/** Fetches are shared across mounted views, including their refresh buttons. */
const pending = new Map<string, Promise<FeedResponse<unknown>>>();
export interface FeedResponse<T> {
  data: T;
  offline: boolean;
  receivedAt: number | null;
}

export function fetchFeed<T>(url: string): Promise<FeedResponse<T>> {
  let request = pending.get(url);
  if (!request) {
    request = fetchWithTimeout(url, async (res) => {
      if (!res.ok) {
        const delay = retryAfterMs(res.headers.get('Retry-After'));
        await res.body?.cancel().catch(() => undefined);
        throw new FeedHttpError(res.status, delay === null ? null : Date.now() + delay);
      }
      const offline = res.headers.get('X-TrafficPulse-Offline') === '1';
      const cachedAt = Number(res.headers.get('X-TrafficPulse-Cached-At'));
      return { data: await res.json(), offline, receivedAt: offline ? (cachedAt > 0 ? cachedAt : null) : Date.now() };
    }).finally(() => pending.delete(url));
    pending.set(url, request);
  }
  return request as Promise<FeedResponse<T>>;
}
