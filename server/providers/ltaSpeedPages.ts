import { config } from '../../config/server.ts';
import { UpstreamHttpError } from '../../shared/diagnostics.ts';
import { fetchProvider } from '../http/providerFetch.ts';
const SPEED_BANDS_ENDPOINT = config.server.upstreams.speedBands;
const MAX_ATTEMPTS = config.server.speeds.attempts;
export async function fetchPage(skip: number, accountKey: string): Promise<{ value: any[]; lastUpdatedTime?: string }> {
  let lastError: unknown = new Error('Speed data unavailable');
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetchProvider(`${SPEED_BANDS_ENDPOINT}?$skip=${skip}`, {
        headers: { AccountKey: accountKey, accept: 'application/json' },
        signal: AbortSignal.timeout(config.server.requestTimeoutMs),
      });
      if (response.ok) {
        const data = await response.json();
        if (!Array.isArray(data?.value)) throw new Error('Unexpected LTA payload');
        return { value: data.value, lastUpdatedTime: data.lastUpdatedTime };
      }
      lastError = new UpstreamHttpError(response.status);
      await response.body?.cancel().catch(() => undefined);
    } catch (err: any) {
      lastError = err;
    }
    // Back off before retrying; LTA throttles bursts.
    if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, config.server.lta.retryDelayMs * attempt));
  }
  throw lastError;
}
