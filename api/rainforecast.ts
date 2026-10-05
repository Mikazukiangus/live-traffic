/**
 * NEA Two-Hour Weather Forecast Serverless Endpoint (keyless)
 * Upstream: https://api-open.data.gov.sg/v2/real-time/api/two-hr-forecast
 * Returns the 47 forecast areas with their coordinates and current 2-hour forecast.
 */
import { setCorsHeaders } from './_client.ts';

const TWO_HR_FORECAST = 'https://api-open.data.gov.sg/v2/real-time/api/two-hr-forecast';
// NEA issues a new forecast about every 30 minutes.
const CACHE_CONTROL = 'public, max-age=0, s-maxage=300, stale-while-revalidate=600';

function send(res: any, status: number, body: unknown, cacheControl = 'no-store') {
  if (res && typeof res.status === 'function') {
    setCorsHeaders(res);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', cacheControl);
    return res.status(status).json(body);
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': cacheControl },
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
    const response = await fetch(TWO_HR_FORECAST, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Upstream responded ${response.status}`);

    // v2 responses are wrapped: { code, errorMsg, data: { area_metadata, items } }
    const json = await response.json();
    if (json?.code !== 0 || !json?.data) throw new Error(json?.errorMsg || 'Unexpected forecast payload');

    const item = json.data.items?.[0];
    if (!item) throw new Error('No forecast issued');
    const forecastByArea = new Map<string, string>(
      (item.forecasts || []).map((f: any) => [f.area, f.forecast])
    );

    const areas = (json.data.area_metadata || [])
      .filter((a: any) => forecastByArea.has(a.name))
      .map((a: any) => ({
        name: a.name,
        lat: a.label_location?.latitude,
        lon: a.label_location?.longitude,
        forecast: forecastByArea.get(a.name),
      }));

    return send(
      res,
      200,
      {
        success: true,
        source: 'nea_two_hr_forecast',
        issuedAt: item.timestamp,
        updatedAt: item.update_timestamp,
        validPeriod: item.valid_period,
        areas,
      },
      CACHE_CONTROL
    );
  } catch (error: any) {
    return send(res, 502, {
      success: false,
      error: 'Failed to fetch NEA 2-hour forecast',
      message: error?.message,
    });
  }
}

export async function GET(request: Request) {
  return handler(request);
}
