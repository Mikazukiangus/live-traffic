import { config } from '../../config/client';
import { withRequestDeadline } from '../../shared/requestDeadline';

export function requestTimeoutMs(url: string) {
  const path = new URL(url, config.siteUrl).pathname;
  if (path === '/api/expresswayspeeds') return config.timeouts.speeds;
  if (path === '/api/health') return config.healthTimeoutMs;
  return config.timeouts.request;
}

/** Consume the response inside the deadline so a stalled body cannot pin a shared refresh. */
export function fetchWithTimeout<T>(
  url: string,
  consume: (response: Response) => Promise<T>,
  init: RequestInit = {},
  timeoutMs = requestTimeoutMs(url),
): Promise<T> {
  return withRequestDeadline(timeoutMs, async (signal) => {
    const response = await fetch(url, { ...init, signal });
    return consume(response);
  }, init.signal);
}
