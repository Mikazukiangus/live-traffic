import { safeFailure, UpstreamHttpError } from '../shared/diagnostics.ts';
import { fetchDataGovV2 } from './providers/dataGov.ts';
import { config } from '../config/server.ts';
const PROBE_TIMEOUT_MS = config.server.probeTimeoutMs;
export interface ProbeResult {
  status: 'UP' | 'DOWN';
  httpCode: number;
  latencyMs: number;
  error?: string;
}

export async function probe(url: string, headers: Record<string, string> = {}): Promise<ProbeResult> {
  const start = Date.now();
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json', ...headers },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    // Drain the body so the connection is released.
    await response.arrayBuffer().catch(() => undefined);
    return {
      status: response.ok ? 'UP' : 'DOWN',
      httpCode: response.status,
      latencyMs: Date.now() - start,
      ...(response.ok ? {} : { error: `Upstream responded ${response.status}` }),
    };
  } catch (err: any) {
    return {
      status: 'DOWN',
      httpCode: 0,
      latencyMs: Date.now() - start,
      error: safeFailure('gateway', err).body.error,
    };
  }
}

export function missingKey(): ProbeResult {
  return { status: 'DOWN', httpCode: 401, latencyMs: 0, error: 'LTA_ACCOUNT_KEY not configured' };
}

/** Paced with application requests; probes do not retry a rate limit or use cached successes. */
export async function probeDataGov(url: string): Promise<ProbeResult> {
  const start = Date.now();
  try {
    await fetchDataGovV2(url, { retry: false, timeoutMs: PROBE_TIMEOUT_MS });
    return { status: 'UP', httpCode: 200, latencyMs: Date.now() - start };
  } catch (error) {
    return {
      status: 'DOWN',
      httpCode: error instanceof UpstreamHttpError ? error.status : 0,
      latencyMs: Date.now() - start,
      error: safeFailure('nea', error).body.error,
    };
  }
}
