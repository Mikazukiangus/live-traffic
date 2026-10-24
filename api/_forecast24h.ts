import { createFeedResultCache, feedResult } from '../server/cache/feedResult.ts';
import { parseSgt } from '../shared/time.ts';
import { providerFailureStatus, providerFailureHeaders } from '../server/http/providerFailure.ts';
import { internalFeedSchema } from '../server/http/requestSchemas.ts';
import { withListResponse } from '../server/http/listPagination.ts';
import { reportFailure } from '../shared/diagnostics.ts';
import { config } from '../config/server.ts';
/**
 * NEA 24-Hour Weather Forecast Serverless Endpoint (keyless)
 * Upstream: https://api-open.data.gov.sg/v2/real-time/api/twenty-four-hr-forecast
 * Returns the island-wide outlook and the forecast for each region over the next three periods.
 */
import { fetchDataGovV2, liveCacheHeaders } from './_client.ts';

const TWENTY_FOUR_HR_FORECAST = config.server.upstreams.forecast24h;
// NEA reissues this a few times a day.
const CACHE = liveCacheHeaders(...config.server.cache.forecast24h);
const REGIONS = ['north', 'south', 'east', 'west', 'central'] as const;

async function loadForecast() {
  try {
    const data = await fetchDataGovV2(TWENTY_FOUR_HR_FORECAST);

    const record = data.records?.[0];
    if (!record?.general) throw new Error('No forecast issued');
    const { general } = record;

    return feedResult(
      200,
      {
        success: true,
        source: 'nea_twenty_four_hr_forecast',
        issuedAt: record.timestamp,
        updatedAt: record.updatedTimestamp,
        general: {
          validPeriod: general.validPeriod,
          forecast: general.forecast?.text,
          temperature: { low: general.temperature?.low, high: general.temperature?.high },
          humidity: { low: general.relativeHumidity?.low, high: general.relativeHumidity?.high },
          wind: {
            direction: general.wind?.direction,
            lowKmH: general.wind?.speed?.low,
            highKmH: general.wind?.speed?.high,
          },
        },
        periods: (record.periods || []).map((p: any) => ({
          text: p.timePeriod?.text,
          start: p.timePeriod?.start,
          end: p.timePeriod?.end,
          regions: Object.fromEntries(REGIONS.map((r) => [r, p.regions?.[r]?.text || null])),
        })),
      },
      CACHE,
    );
  } catch (error: any) {
    return feedResult(providerFailureStatus(error), reportFailure('nea', error), providerFailureHeaders(error));
  }
}
const resultCache = createFeedResultCache({ load: loadForecast, ttlMs: config.server.weather.forecast24hCacheTtlMs,
  profile: config.server.cache.forecast24h, complete: body => Array.isArray(body.periods) && parseSgt(body.issuedAt) !== null && typeof body.general?.forecast === 'string', validUntil: body => parseSgt(body.general?.validPeriod?.end) });
/** Internal instance-local invalidation; not a public cache-bypass endpoint. */
export const invalidateResultCache = resultCache.invalidate;
const handler = withListResponse(internalFeedSchema('forecast24h'), 'forecast24h', ['periods'], async (_req, _res, { send }) => {
  const result = await resultCache.get();
  return send(result.status, result.body, result.headers);
});
export default handler;

export async function GET(request: Request) {
  return handler(request);
}
