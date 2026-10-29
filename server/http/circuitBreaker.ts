import { CircuitOpenError, InvalidPayloadError, UpstreamHttpError } from '../../shared/diagnostics.ts';
import { transientReadError } from '../../shared/readRetry.ts';
import { ImagePolicyError } from './readImage.ts';

export interface CircuitPermit { recovery: boolean; check: () => void }
export type CircuitRunner = <T>(url: string, operation: (permit: CircuitPermit) => Promise<T>, caller?: AbortSignal | null) => Promise<T>;
interface Policy { failureThreshold: number; windowMs: number; cooldownMs: number }
interface State { generation: number; failures: number[]; until: number | null; probing: boolean }

/** Rate limits/auth/policy errors and caller cancellation are not provider outages. */
export function circuitFailure(error: unknown): boolean {
  if (error instanceof CircuitOpenError || error instanceof ImagePolicyError) return false;
  if (error instanceof UpstreamHttpError) return [408, 500, 502, 503, 504].includes(error.status);
  return error instanceof InvalidPayloadError || error instanceof SyntaxError || transientReadError(error);
}

/** One bounded key per registered dependency; no timers, URLs or credentials retained in state. */
export function createCircuitRunner(policy: Policy, scope: (url: string) => string | null, now = Date.now): CircuitRunner {
  const states = new Map<string, State>();
  return async (url, operation, caller) => {
    caller?.throwIfAborted();
    const key = scope(url);
    if (key === null) return operation({ recovery: false, check() { caller?.throwIfAborted(); } });
    let state = states.get(key);
    if (!state) {
      state = { generation: 0, failures: [], until: null, probing: false };
      states.set(key, state);
    }
    const blocked = () => new CircuitOpenError(Math.max(now() + 1, state!.until ?? now()));
    const recovery = state.until !== null;
    if (recovery && (state.until! > now() || state.probing)) throw blocked();
    if (recovery) state.probing = true;
    const generation = state.generation;
    const permit: CircuitPermit = { recovery, check() {
      caller?.throwIfAborted();
      if (state!.generation !== generation || (!recovery && state!.until !== null)) throw blocked();
    } };
    try {
      const result = await operation(permit);
      if (state.generation === generation) {
        state.failures = [];
        if (recovery) { state.until = null; state.probing = false; state.generation++; }
      }
      return result;
    } catch (error) {
      if (state.generation === generation) {
        if (!caller?.aborted && circuitFailure(error)) {
          const time = now();
          state.failures = state.failures.filter(at => at > time - policy.windowMs);
          state.failures.push(time);
          if (recovery || state.failures.length >= policy.failureThreshold) {
            state.until = time + policy.cooldownMs;
            state.probing = false;
            state.failures = [];
            state.generation++;
          }
        } else if (recovery) {
          // A neutral outcome (e.g. caller abort/401/429) permits another trial, without claiming recovery.
          state.probing = false;
        }
      }
      throw error;
    }
  };
}
