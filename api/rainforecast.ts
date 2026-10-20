import { reportFailure } from '../shared/diagnostics.ts';
import { config } from '../config/server.ts';
import { DataGovHttpError } from '../server/providers/dataGovClient.ts';
import { createRainService } from '../server/weather/rainService.ts';
import { fetchDataGovV2, handlePreflight, NO_STORE, liveCacheHeaders, sendJson } from './_client.ts';

const service = createRainService({
  fetch: () => fetchDataGovV2(config.server.upstreams.rain),
  now: Date.now,
  ttlMs: config.server.weather.rainCacheTtlMs,
  maxRetainedMs: config.server.weather.rainMaxRetainedMs,
  onFailure: (error) => {
    reportFailure('nea', error);
  },
});
export default async function handler(req: any, res?: any) {
  const preflight = handlePreflight(req, res);
  if (preflight) return preflight;
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
    const headers = { ...NO_STORE };
    if (error instanceof DataGovHttpError && error.retryAt && error.retryAt > Date.now())
      headers['Retry-After'] = String(Math.ceil((error.retryAt - Date.now()) / 1000));
    return sendJson(res, 502, reportFailure('nea', error), headers);
  }
}
export async function GET(request: Request) {
  return handler(request);
}
