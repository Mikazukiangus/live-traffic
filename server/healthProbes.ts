import { safeFailure } from '../shared/diagnostics.ts';
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
