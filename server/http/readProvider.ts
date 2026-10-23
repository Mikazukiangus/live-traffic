import { withProviderCircuit } from './providerCircuits.ts';
import type { CircuitRunner, CircuitPermit } from './circuitBreaker.ts';
import { config } from '../../config/server.ts';
import { CircuitOpenError, UpstreamHttpError } from '../../shared/diagnostics.ts';
import { retryAfterMs } from '../../shared/httpRetry.ts';
import { readRetryDelay, retryableReadStatus, safeReadRequest, transientReadError } from '../../shared/readRetry.ts';
import { waitForRetry, withRequestDeadline } from '../../shared/requestDeadline.ts';
import { fetchProvider } from './providerFetch.ts';
import { NO_STORE } from './responses.ts';

export class ProviderReadError extends UpstreamHttpError {
  constructor(status: number, readonly retryAt: number | null) { super(status); }
}
export const providerRetryHeaders = (error: unknown, now = Date.now()): Record<string, string> =>
  (error instanceof ProviderReadError || error instanceof CircuitOpenError) && error.retryAt !== null && error.retryAt > now
    ? { ...NO_STORE, 'Retry-After': String(Math.ceil((error.retryAt - now) / 1000)) } : NO_STORE;

interface Options { attempts?: number; timeoutMs?: number; baseDelayMs?: number; maxWaitMs?: number }
interface Dependencies {
  fetch: typeof fetchProvider;
  now: () => number;
  random: () => number;
  sleep: typeof waitForRetry;
  circuit?: CircuitRunner;
}

/** One owner for retries, body consumption and the entire deadline. No transport-global retry layer. */
export function createProviderReader(deps: Dependencies) {
  return async function readProvider<T>(
    url: string, consume: (response: Response) => Promise<T>, init: RequestInit = {}, options: Options = {},
  ): Promise<T> {
    const attempts = safeReadRequest(init) ? (options.attempts ?? config.server.lta.attempts) : 1;
    const timeoutMs = options.timeoutMs ?? config.server.requestTimeoutMs;
    const maxWaitMs = options.maxWaitMs ?? config.server.retryMaxWaitMs;
    const baseMs = options.baseDelayMs ?? config.server.lta.retryDelayMs;
    const deadline = deps.now() + timeoutMs;
    const run = async (permit: CircuitPermit) => withRequestDeadline(timeoutMs, async (signal) => {
      for (let attempt = 1; ; attempt++) {
        signal.throwIfAborted();
        permit.check();
        let error: unknown;
        let providerDelay: number | null = null;
        try {
          const response = await deps.fetch(url, { ...init, signal });
          if (response.ok) return await consume(response);
          const rawDelay = response.headers.get('Retry-After');
          providerDelay = retryAfterMs(rawDelay, deps.now());
          // An enormous valid delta must not turn into an immediate retry through numeric overflow.
          if (providerDelay === null && rawDelay && /^\d+$/.test(rawDelay.trim())) providerDelay = Infinity;
          error = new ProviderReadError(response.status,
            providerDelay !== null && Number.isFinite(providerDelay) ? deps.now() + providerDelay : null);
          await response.body?.cancel().catch(() => undefined);
        } catch (failure) { error = failure; }
        const transient = error instanceof UpstreamHttpError ? retryableReadStatus(error.status) : transientReadError(error);
        if (signal.aborted) throw signal.reason;
        if (!transient || permit.recovery || attempt >= attempts) throw error;
        const delay = readRetryDelay(attempt, baseMs, maxWaitMs, deps.random(), providerDelay);
        if (delay === null || delay >= deadline - deps.now()) throw error;
        await deps.sleep(delay, signal);
      }
    }, init.signal);
    return deps.circuit && safeReadRequest(init)
      ? deps.circuit(url, run, init.signal)
      : run({ recovery: false, check() { init.signal?.throwIfAborted(); } });
  };
}

export const readProvider = createProviderReader({ fetch: fetchProvider, now: Date.now, random: Math.random, sleep: waitForRetry, circuit: withProviderCircuit });
