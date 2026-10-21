import { UpstreamHttpError } from '../../shared/diagnostics.ts';
import { retryAfterMs } from '../../shared/httpRetry.ts';

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
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  intervalMs: number;
  retryDelayMs: number;
  maxRetryWaitMs: number;
  timeoutMs: number;
}

/** An instance-local gate smooths bursts; it is not a distributed provider quota. */
export function createDataGovClient(deps: Dependencies) {
  const pending = new Map<string, Promise<any>>();
  let gate = Promise.resolve();
  let nextStart = 0;
  let cooldownUntil = 0;
  const enter = () => {
    const ticket = gate.then(async () => {
      if (cooldownUntil > deps.now()) throw new DataGovHttpError(429, cooldownUntil);
      const wait = nextStart - deps.now();
      if (wait > 0) await deps.sleep(wait);
      if (cooldownUntil > deps.now()) throw new DataGovHttpError(429, cooldownUntil);
      nextStart = deps.now() + deps.intervalMs;
    });
    gate = ticket.catch(() => undefined);
    return ticket;
  };
  async function load(url: string, options: Options) {
    for (let attempt = 0; ; attempt++) {
      await enter();
      const response = await deps.fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(options.timeoutMs ?? deps.timeoutMs),
        redirect: 'error',
      });
      if (response.ok) {
        const json = await response.json();
        if (json?.code !== 0 || !json?.data) throw new Error('Unexpected provider payload');
        return json.data;
      }
      const now = deps.now();
      const delay =
        response.status === 429
          ? (retryAfterMs(response.headers.get('retry-after'), now) ??
            Math.ceil(deps.retryDelayMs * (1 + deps.random() * 0.1)))
          : null;
      await response.body?.cancel().catch(() => undefined);
      if (delay != null) cooldownUntil = Math.max(cooldownUntil, now + delay);
      const error = new DataGovHttpError(response.status, delay != null ? cooldownUntil : null);
      if (response.status !== 429 || options.retry === false || attempt > 0 || delay! > deps.maxRetryWaitMs)
        throw error;
      // One bounded retry, never earlier than the provider's deadline.
      const wait = cooldownUntil - deps.now();
      if (wait > 0) await deps.sleep(wait);
    }
  }
  function data(url: string, options: Options = {}): Promise<any> {
    // Probe time budgets/retry policy remain distinct from ordinary application requests.
    const key = `${options.retry !== false}:${options.timeoutMs ?? deps.timeoutMs}:${url}`;
    let request = pending.get(key);
    if (!request) {
      request = load(url, options).finally(() => pending.delete(key));
      pending.set(key, request);
    }
    return request;
  }
  return { data };
}
