import { config } from '../../config/server.ts';
import { UpstreamHttpError } from '../../shared/diagnostics.ts';
/** Fetches a data.gov.sg v2 real-time feed (wrapped { code, errorMsg, data }), retrying once on 429. */
export async function fetchDataGovV2(url: string): Promise<any> {
  const get = () =>
    fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(config.server.weatherTimeoutMs),
    });
  let response = await get();
  // data.gov.sg rate-limits keyless calls in short bursts; one retry usually gets through.
  if (response.status === 429) {
    await new Promise((r) => setTimeout(r, config.server.weatherRetryDelayMs));
    response = await get();
  }
  if (!response.ok) throw new UpstreamHttpError(response.status);
  const json = await response.json();
  if (json?.code !== 0 || !json?.data) throw new Error('Unexpected provider payload');
  return json.data;
}
