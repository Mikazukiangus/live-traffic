import { captureException } from './errorTracking.ts';
// This module has no environment access and is safe for server, browser and CI use.
const FAILURE_SOURCES = new Set(['psi', 'pm25', 'lightning', 'wbgt', 'roadworks', 'faulty_lights']);
export type FailureSource = 'psi' | 'pm25' | 'lightning' | 'wbgt' | 'roadworks' | 'faulty_lights';
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

/** Safe local admission failure; never retains a provider URL or response. */
export class CircuitOpenError extends UpstreamHttpError {
  constructor(readonly retryAt: number) {
    super(503);
    this.name = 'CircuitOpenError';
  }
}

/** A fixed classification; never retain a rejected value, field value, path or response body. */
export class InvalidPayloadError extends Error {
  constructor() {
    super('Invalid provider response');
    this.name = 'InvalidPayloadError';
  }
}

/** Project untrusted errors into a closed set of diagnostic fields; never serialize them. */
export function safeFailure(service: string, error: unknown, status?: number) {
  const httpCode = status ?? (error instanceof UpstreamHttpError ? error.status : undefined);
  const timeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
  const invalid = error instanceof InvalidPayloadError;
  const open = error instanceof CircuitOpenError;
  const code = open ? 'UPSTREAM_CIRCUIT_OPEN' : invalid
    ? 'UPSTREAM_INVALID_RESPONSE'
    : timeout
      ? 'UPSTREAM_TIMEOUT'
      : validStatus(httpCode)
        ? 'UPSTREAM_HTTP_ERROR'
        : 'UPSTREAM_FAILURE';
  const message = open ? 'Traffic provider temporarily paused; retry shortly' : invalid
    ? 'Traffic provider returned an invalid response'
    : timeout
      ? 'Traffic provider timed out'
      : validStatus(httpCode)
        ? `Upstream responded ${httpCode}`
        : 'Traffic provider temporarily unavailable';
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
export function reportFailure(service: string, error: unknown, status?: number, source?: FailureSource) {
  const { log, body } = safeFailure(service, error, status);
  const event = captureException({ ...log, ...(source && FAILURE_SOURCES.has(source) ? { source } : {}) }, error);
  return { ...body, errorId: event.errorId };
}

/** Labels are fixed at the call site, never derived from a request, URL or provider body. */
export function reportSourceFailure(service: string, source: FailureSource, error: unknown) {
  return reportFailure(service, error, undefined, source);
}
