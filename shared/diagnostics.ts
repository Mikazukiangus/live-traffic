// This module has no environment access and is safe for server, browser and CI use.
const SERVICES = new Set(['lta', 'nea', 'camera', 'gateway', 'vehicle']);
const validStatus = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599;

/** Preserve a numeric upstream status without retaining the provider body or URL. */
export class UpstreamHttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super('Upstream request failed');
    this.name = 'UpstreamHttpError';
    this.status = validStatus(status) ? status : 502;
  }
}

/** Project untrusted errors into a closed set of diagnostic fields; never serialize them. */
export function safeFailure(service: string, error: unknown, status?: number) {
  const httpCode = status ?? (error instanceof UpstreamHttpError ? error.status : undefined);
  const timeout = error instanceof Error &&
    (error.name === 'TimeoutError' || error.name === 'AbortError');
  const code = timeout ? 'UPSTREAM_TIMEOUT' : validStatus(httpCode) ? 'UPSTREAM_HTTP_ERROR' : 'UPSTREAM_FAILURE';
  const message = timeout ? 'Traffic provider timed out'
    : validStatus(httpCode) ? `Upstream responded ${httpCode}` : 'Traffic provider temporarily unavailable';
  return {
    log: {
      event: 'upstream_failure',
      service: SERVICES.has(service) ? service : 'gateway',
      code,
      ...(validStatus(httpCode) ? { upstreamHttpCode: httpCode } : {}),
    },
    body: { success: false, code, error: message },
  };
}

/** No raw exception, stack, cause, headers, config, URL or response body enters the log. */
export function reportFailure(service: string, error: unknown, status?: number) {
  const { log, body } = safeFailure(service, error, status);
  console.error(JSON.stringify(log));
  return body;
}
