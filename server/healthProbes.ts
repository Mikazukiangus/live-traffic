import { withProviderCircuit } from './http/providerCircuits.ts';
import { InvalidPayloadError, safeFailure, UpstreamHttpError } from '../shared/diagnostics.ts';
import { fetchDataGovV2 } from './providers/dataGov.ts';
import { config } from '../config/server.ts';
import { fetchProvider } from './http/providerFetch.ts';
const PROBE_TIMEOUT_MS = config.server.probeTimeoutMs;
export interface ProbeResult {
  status: 'UP' | 'DOWN';
  httpCode: number;
  latencyMs: number;
  error?: string;
}

export async function probe(
  url: string,
  headers: Record<string, string> = {},
  validate?: (value: unknown) => boolean,
): Promise<ProbeResult> {
  const start = Date.now();
  let httpCode = 0;
  try {
    return await withProviderCircuit(url, async (permit) => {
      permit.check();
      const response = await fetchProvider(url, {
        headers: { accept: 'application/json', ...headers },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      httpCode = response.status;
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new UpstreamHttpError(response.status);
      }
      if (validate) {
        let data: unknown;
        try {
          data = await response.json();
        } catch (error) {
          if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) throw error;
          throw new InvalidPayloadError();
        }
        if (!validate(data)) throw new InvalidPayloadError();
      } else {
        // Complete the body under the probe deadline before reporting recovery.
        await response.arrayBuffer();
      }
      return { status: 'UP' as const, httpCode, latencyMs: Date.now() - start };
    });
  } catch (err: any) {
    return {
      status: 'DOWN',
      httpCode: httpCode || (err instanceof UpstreamHttpError ? err.status : 0),
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
