import type { CircuitRunner, CircuitPermit } from '../http/circuitBreaker.ts';
import { InvalidPayloadError, UpstreamHttpError } from '../../shared/diagnostics.ts';
import { retryAfterMs } from '../../shared/httpRetry.ts';
import { readRetryDelay, retryableReadStatus, transientReadError } from '../../shared/readRetry.ts';
import { withRequestDeadline } from '../../shared/requestDeadline.ts';

/** Numeric retry timing is safe metadata; provider headers/bodies/URLs never enter errors. */
export class DataGovHttpError extends UpstreamHttpError {
  constructor(
    status: number,
    readonly retryAt: number | null = null,
  ) {
    super(status);
  }
}
interface Options {
  retry?: boolean;
  timeoutMs?: number;
}
interface Dependencies {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  now: () => number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  random: () => number;
  intervalMs: number;
  retryDelayMs: number;
  maxRetryWaitMs: number;
  timeoutMs: number;
  budgetMs: number;
  transientRetryDelayMs: number;
  circuit?: CircuitRunner;
}

/** An instance-local gate smooths bursts; it is not a distributed provider quota. */
export function createDataGovClient(deps: Dependencies) {
  const pending = new Map<string, Promise<any>>();
  let gate = Promise.resolve();
  let nextStart = 0;
  let cooldownUntil = 0;
  const enter = (signal?: AbortSignal) => {
    const ticket = gate.then(async () => {
      signal?.throwIfAborted();
      if (cooldownUntil > deps.now()) throw new DataGovHttpError(429, cooldownUntil);
      const wait = nextStart - deps.now();
      if (wait > 0) await deps.sleep(wait, signal);
      signal?.throwIfAborted();
      if (cooldownUntil > deps.now()) throw new DataGovHttpError(429, cooldownUntil);
      nextStart = deps.now() + deps.intervalMs;
    });
    gate = ticket.catch(() => undefined);
    return ticket;
  };
  async function load(url: string, options: Options, permit: CircuitPermit) {
    permit.check();
    await enter();
    permit.check();
    const perAttemptMs = options.timeoutMs ?? deps.timeoutMs;
    const budgetMs = options.retry === false ? perAttemptMs : deps.budgetMs;
    const deadline = deps.now() + budgetMs;
    return withRequestDeadline(budgetMs, async (signal) => {
      for (let attempt = 0; ; attempt++) {
        signal.throwIfAborted();
        permit.check();
        let error: unknown;
        let providerDelay: number | null = null;
        let baseMs = deps.transientRetryDelayMs;
        try {
          const response = await deps.fetch(url, {
            method: 'GET', headers: { accept: 'application/json' },
            signal: AbortSignal.any([signal, AbortSignal.timeout(perAttemptMs)]), redirect: 'error',
          });
          if (response.ok) {
            const json = await response.json();
            if (json?.code !== 0 || !json?.data) throw new InvalidPayloadError();
            return json.data;
          }
          const now = deps.now();
          const rawDelay = response.headers.get('retry-after');
          providerDelay = retryAfterMs(rawDelay, now);
          if (providerDelay === null && rawDelay && /^\d+$/.test(rawDelay.trim())) providerDelay = Infinity;
          if (response.status === 429) {
            baseMs = deps.retryDelayMs;
            providerDelay ??= Math.ceil(baseMs * (1 + deps.random() * 0.25));
            cooldownUntil = Math.max(cooldownUntil, Math.min(Number.MAX_SAFE_INTEGER, now + providerDelay));
          }
          error = new DataGovHttpError(response.status,
            response.status === 429 ? cooldownUntil : providerDelay !== null && Number.isFinite(providerDelay) ? now + providerDelay : null);
          await response.body?.cancel().catch(() => undefined);
        } catch (failure) { error = failure; }
        if (signal.aborted) throw signal.reason;
        const transient = error instanceof DataGovHttpError ? retryableReadStatus(error.status) : transientReadError(error);
        if (!transient || permit.recovery || options.retry === false || attempt >= 1) throw error;
        const delay = readRetryDelay(attempt + 1, baseMs, deps.maxRetryWaitMs, deps.random(), providerDelay);
        if (delay === null || delay >= deadline - deps.now()) throw error;
        await deps.sleep(delay, signal);
        permit.check();
        await enter(signal);
      }
    });
  }
  function data(url: string, options: Options = {}): Promise<any> {
    // Probe time budgets/retry policy remain distinct from ordinary application requests.
    const key = `${options.retry !== false}:${options.timeoutMs ?? deps.timeoutMs}:${url}`;
    let request = pending.get(key);
    if (!request) {
      const run = (permit: CircuitPermit) => load(url, options, permit);
      request = (deps.circuit ? deps.circuit(url, run) : run({ recovery: false, check() {} }))
        .finally(() => pending.delete(key));
      pending.set(key, request);
    }
    return request;
  }
  return { data };
}
