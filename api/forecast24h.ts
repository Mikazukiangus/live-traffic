import { reportFailure, UpstreamHttpError } from '../shared/diagnostics.ts';
import { config } from '../config/server.ts';
/**
 * NEA 24-Hour Weather Forecast Serverless Endpoint (keyless)
 * Upstream: https://api-open.data.gov.sg/v2/real-time/api/twenty-four-hr-forecast
 * Returns the island-wide outlook and the forecast for each region over the next three periods.
 */
import { NO_STORE, liveCacheHeaders, setCorsHeaders, setHeaders } from './_client.ts';

const TWENTY_FOUR_HR_FORECAST = config.server.upstreams.forecast24h;
// NEA reissues this a few times a day.
const CACHE = liveCacheHeaders(...config.server.cache.forecast24h);
const REGIONS = ['north', 'south', 'east', 'west', 'central'] as const;

function send(res: any, status: number, body: unknown, cache = NO_STORE) {
  if (res && typeof res.status === 'function') {
    setCorsHeaders(res);
    res.setHeader('Content-Type', 'application/json');
    setHeaders(res, cache);
    return res.status(status).json(body);
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': config.server.corsOrigin, ...cache },
  });
}

export default async function handler(req: any, res?: any) {
  if (req && req.method === 'OPTIONS') {
    if (res && typeof res.status === 'function') {
      setCorsHeaders(res);
      return res.status(204).end();
    }
    return new Response(null, { status: 204 });
  }

  try {
    const response = await fetch(TWENTY_FOUR_HR_FORECAST, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(config.server.weatherTimeoutMs),
    });
    if (!response.ok) throw new UpstreamHttpError(response.status);

    // v2 responses are wrapped: { code, errorMsg, data: { records } }
    const json = await response.json();
    if (json?.code !== 0 || !json?.data) throw new Error('Unexpected forecast payload');

    const record = json.data.records?.[0];
    if (!record?.general) throw new Error('No forecast issued');
    const { general } = record;

    return send(
      res,
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
      CACHE
    );
  } catch (error: any) {
    return send(res, 502, reportFailure('nea', error));
  }
}

export async function GET(request: Request) {
  return handler(request);
}
