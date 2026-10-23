/** Bound the complete async operation, including body reads; never retain its URL or credentials. */
export async function withRequestDeadline<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
  parent?: AbortSignal | null,
): Promise<T> {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new RangeError('Invalid request timeout');
  const controller = new AbortController();
  const signal = controller.signal;
  const cancel = () => controller.abort(parent!.reason);
  let rejectAbort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(signal.reason);
    signal.addEventListener('abort', rejectAbort, { once: true });
  });
  const timer = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeoutMs);
  parent?.addEventListener('abort', cancel, { once: true });
  if (parent?.aborted) cancel();
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        signal.throwIfAborted();
        return operation(signal);
      }),
      aborted,
    ]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', cancel);
    signal.removeEventListener('abort', rejectAbort);
  }
}

/** Backoff/pacing sleeps release their timer immediately when the request is cancelled. */
export function waitForRetry(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const cancel = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); reject(signal!.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, ms);
    signal?.addEventListener('abort', cancel, { once: true });
  });
}
