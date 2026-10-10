/** Fetches are shared across mounted views, including their refresh buttons. */
const pending = new Map<string, Promise<FeedResponse<unknown>>>();
export interface FeedResponse<T> { data: T; offline: boolean; receivedAt: number | null }

export function fetchFeed<T>(url: string): Promise<FeedResponse<T>> {
  let request = pending.get(url);
  if (!request) {
    request = (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const offline = res.headers.get('X-TrafficPulse-Offline') === '1';
      const cachedAt = Number(res.headers.get('X-TrafficPulse-Cached-At'));
      return { data: await res.json(), offline, receivedAt: offline ? (cachedAt > 0 ? cachedAt : null) : Date.now() };
    })().finally(() => pending.delete(url));
    pending.set(url, request);
  }
  return request as Promise<FeedResponse<T>>;
}
