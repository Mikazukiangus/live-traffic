import { CircuitOpenError } from '../../shared/diagnostics.ts';
import { DataGovHttpError } from '../providers/dataGovClient.ts';
import { providerRetryHeaders } from './readProvider.ts';
import { NO_STORE } from './responses.ts';

export const providerFailureStatus = (error: unknown, fallback = 502) => error instanceof CircuitOpenError ? 503 : fallback;
export function providerFailureHeaders(error: unknown, now = Date.now()): Record<string, string> {
  if (error instanceof DataGovHttpError && error.retryAt !== null && error.retryAt > now)
    return { ...NO_STORE, 'Retry-After': String(Math.ceil((error.retryAt - now) / 1000)) };
  return providerRetryHeaders(error, now);
}
/** Preserve a temporary admission failure when every independent source has failed. */
export const failedDependency = (...errors: unknown[]) => errors.find(error => error instanceof CircuitOpenError) ?? errors[0];
