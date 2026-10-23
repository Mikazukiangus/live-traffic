/** Conservative policy for explicitly read-only HTTP operations, shared without environment access. */
export const retryableReadStatus = (status: number) => [408, 429, 500, 502, 503, 504].includes(status);
export const safeReadRequest = (init: RequestInit) =>
  ['GET', 'HEAD'].includes((init.method ?? 'GET').toUpperCase()) && init.body == null;

const NETWORK_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET',
]);
/** Never infer retryability from message text or a generic TypeError (which may mean TLS/SSRF/redirect failure). */
export function transientReadError(error: unknown, depth = 0): boolean {
  if (!(error instanceof Error) || depth > 5) return false;
  if (error.name === 'TimeoutError') return true;
  if (error.name === 'AbortError' || error.name === 'SyntaxError' || error.name === 'InvalidPayloadError' || error.name === 'SsrfError') return false;
  const record = error as Error & { code?: string; errors?: unknown[] };
  if (record.code && !NETWORK_CODES.has(record.code)) return false;
  if (Array.isArray(record.errors)) return record.errors.length > 0 && record.errors.every((child) => transientReadError(child, depth + 1));
  return error.cause instanceof Error ? transientReadError(error.cause, depth + 1) : !!record.code;
}

/** Bounded exponential backoff with 0–25% jitter. A valid provider minimum is never shortened. */
export function readRetryDelay(
  failure: number, baseMs: number, maxWaitMs: number, random: number, providerDelay: number | null,
): number | null {
  if (providerDelay !== null && (!Number.isFinite(providerDelay) || providerDelay > maxWaitMs)) return null;
  const jitter = Number.isFinite(random) ? Math.min(1, Math.max(0, random)) : 0;
  const exponential = Math.min(maxWaitMs, baseMs * 2 ** Math.min(20, Math.max(0, failure - 1)));
  return Math.max(providerDelay ?? 0, Math.min(maxWaitMs, Math.ceil(exponential * (1 + jitter * 0.25))));
}
