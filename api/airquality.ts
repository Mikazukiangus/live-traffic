/**
 * NEA Air Quality Serverless Endpoint (keyless)
 * Upstream: https://api-open.data.gov.sg/v2/real-time/api/psi
 *           https://api-open.data.gov.sg/v2/real-time/api/pm25
 * Returns the 24-hour PSI and the latest 1-hour PM2.5 for each of the five regions.
 * Either reading may be null when its feed fails; the endpoint fails only if both do.
 */
import { NO_STORE, liveCacheHeaders, setCorsHeaders, setHeaders } from './_client.ts';

const PSI_URL = 'https://api-open.data.gov.sg/v2/real-time/api/psi';
const PM25_URL = 'https://api-open.data.gov.sg/v2/real-time/api/pm25';
// NEA publishes both readings hourly.
const CACHE = liveCacheHeaders(300, 600);
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
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', ...cache },
  });
}

// v2 responses are wrapped: { code, errorMsg, data: { regionMetadata, items } }
async function fetchLatest(url: string) {
  const get = () => fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
  let response = await get();
  // data.gov.sg rate-limits keyless calls in short bursts; one retry usually gets through.
  if (response.status === 429) {
    await new Promise((r) => setTimeout(r, 1500));
    response = await get();
  }
  if (!response.ok) throw new Error(`Upstream responded ${response.status}`);
  const json = await response.json();
  if (json?.code !== 0 || !json?.data) throw new Error(json?.errorMsg || 'Unexpected payload');
  const item = json.data.items?.[0];
  if (!item?.readings) throw new Error('No readings published');
  return { item, regions: json.data.regionMetadata || [] };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export default async function handler(req: any, res?: any) {
  if (req && req.method === 'OPTIONS') {
    if (res && typeof res.status === 'function') {
      setCorsHeaders(res);
      return res.status(204).end();
    }
    return new Response(null, { status: 204 });
  }

  const [psi, pm25] = await Promise.allSettled([fetchLatest(PSI_URL), fetchLatest(PM25_URL)]);
  if (psi.status === 'rejected' && pm25.status === 'rejected') {
    return send(res, 502, {
      success: false,
      error: 'Failed to fetch NEA air quality',
      message: `PSI: ${psi.reason?.message}; PM2.5: ${pm25.reason?.message}`,
    });
  }

  const psiData = psi.status === 'fulfilled' ? psi.value : null;
  const pm25Data = pm25.status === 'fulfilled' ? pm25.value : null;
  const metadata = psiData?.regions.length ? psiData.regions : pm25Data?.regions || [];
  const location = new Map<string, any>(metadata.map((r: any) => [r.name, r.labelLocation]));
  const psi24h = psiData?.item.readings.psi_twenty_four_hourly || {};
  const pm25Day = psiData?.item.readings.pm25_twenty_four_hourly || {};
  const pm25Hour = pm25Data?.item.readings.pm25_one_hourly || {};

  return send(
    res,
    200,
    {
      success: true,
      source: 'nea_psi_pm25',
      psiTimestamp: psiData?.item.timestamp ?? null,
      pm25Timestamp: pm25Data?.item.timestamp ?? null,
      regions: REGIONS.map((name) => ({
        name,
        lat: location.get(name)?.latitude ?? null,
        lon: location.get(name)?.longitude ?? null,
        psi24h: num(psi24h[name]),
        pm25OneHour: num(pm25Hour[name]),
        pm25TwentyFourHour: num(pm25Day[name]),
      })),
    },
    // A partial answer is served but not cached, so the next request tries both feeds again.
    psiData && pm25Data ? CACHE : NO_STORE
  );
}

export async function GET(request: Request) {
  return handler(request);
}
