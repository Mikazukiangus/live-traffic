import { providerFailureStatus, providerFailureHeaders } from '../server/http/providerFailure.ts';
import { requestSchemas } from '../server/http/requestSchemas.ts';
import { withRequestSchema } from '../server/http/validateRequest.ts';
import { reportFailure } from '../shared/diagnostics.ts';
import { config } from '../config/server.ts';
import { createRainService } from '../server/weather/rainService.ts';
import { fetchDataGovV2, NO_STORE, liveCacheHeaders, sendJson } from './_client.ts';

const service = createRainService({
  fetch: () => fetchDataGovV2(config.server.upstreams.rain),
  now: Date.now,
  ttlMs: config.server.weather.rainCacheTtlMs,
  maxRetainedMs: config.server.weather.rainMaxRetainedMs,
  onFailure: (error) => {
    reportFailure('nea', error);
  },
});
const handler = withRequestSchema(requestSchemas.empty, async (req, res) => {
  try {
    const { data, cacheSeconds } = await service.get();
    // No stale CDN window: the edge must not serve beyond the forecast's published end.
    const headers =
      data.delivery?.state === 'retained' || cacheSeconds === 0
        ? { ...NO_STORE }
        : liveCacheHeaders(Math.min(cacheSeconds, config.server.cache.weather[0]), 0);
    if (data.delivery?.retryAt && data.delivery.retryAt > Date.now())
      headers['Retry-After'] = String(Math.ceil((data.delivery.retryAt - Date.now()) / 1000));
    return sendJson(res, 200, data, headers);
  } catch (error) {
    return sendJson(res, providerFailureStatus(error), reportFailure('nea', error), providerFailureHeaders(error));
  }
});
export default handler;
export async function GET(request: Request) {
  return handler(request);
}
