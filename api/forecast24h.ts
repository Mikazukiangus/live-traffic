import { providerFailureStatus, providerFailureHeaders } from '../server/http/providerFailure.ts';
import { requestSchemas } from '../server/http/requestSchemas.ts';
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

const handler = withListResponse(requestSchemas.empty, 'forecast24h', ['periods'], async (_req, res, { send }) => {
  try {
    const data = await fetchDataGovV2(TWENTY_FOUR_HR_FORECAST);

    const record = data.records?.[0];
    if (!record?.general) throw new Error('No forecast issued');
    const { general } = record;

    return send(
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
    return send(providerFailureStatus(error), reportFailure('nea', error), providerFailureHeaders(error));
  }
});
export default handler;

export async function GET(request: Request) {
  return handler(request);
}
