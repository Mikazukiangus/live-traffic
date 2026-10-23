import { isRecord } from '../shared/traffic/validation.ts';
import { providerFailureStatus, providerFailureHeaders, failedDependency } from '../server/http/providerFailure.ts';
import { requestSchemas } from '../server/http/requestSchemas.ts';
import { withRequestSchema } from '../server/http/validateRequest.ts';
import { reportSourceFailure, safeFailure, InvalidPayloadError } from '../shared/diagnostics.ts';
import { config } from '../config/server.ts';
/**
 * NEA Air Quality Serverless Endpoint (keyless)
 * Upstream: https://api-open.data.gov.sg/v2/real-time/api/psi
 *           https://api-open.data.gov.sg/v2/real-time/api/pm25
 * Returns the 24-hour PSI and the latest 1-hour PM2.5 for each of the five regions.
 * Either reading may be null when its feed fails; the endpoint fails only if both do.
 */
import { fetchDataGovV2, NO_STORE, liveCacheHeaders, setHeaders } from './_client.ts';

const PSI_URL = config.server.upstreams.psi;
const PM25_URL = config.server.upstreams.pm25;
// NEA publishes both readings hourly.
const CACHE = liveCacheHeaders(...config.server.cache.weather);
const REGIONS = ['north', 'south', 'east', 'west', 'central'] as const;

function send(res: any, status: number, body: unknown, cache = NO_STORE) {
  if (res && typeof res.status === 'function') {
    res.setHeader('Content-Type', 'application/json');
    setHeaders(res, cache);
    return res.status(status).json(body);
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cache },
  });
}

// v2 responses are wrapped: { code, errorMsg, data: { regionMetadata, items } }
async function fetchLatest(url: string) {
  const data = await fetchDataGovV2(url);
  const item = data.items?.[0];
  const regions = data.regionMetadata ?? [];
  if (!isRecord(item?.readings) || !Array.isArray(regions) || regions.some((r: unknown) => !isRecord(r) || typeof r.name !== 'string'))
    throw new InvalidPayloadError();
  return { item, regions };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const handler = withRequestSchema(requestSchemas.empty, async (_req, res) => {
  const [psi, pm25] = await Promise.allSettled([fetchLatest(PSI_URL), fetchLatest(PM25_URL)]);
  if (psi.status === 'rejected') reportSourceFailure('nea', 'psi', psi.reason);
  if (pm25.status === 'rejected') reportSourceFailure('nea', 'pm25', pm25.reason);
  if (psi.status === 'rejected' && pm25.status === 'rejected') {
    const error = failedDependency(psi.reason, pm25.reason);
    return send(res, providerFailureStatus(error), safeFailure('nea', error).body, providerFailureHeaders(error));
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
    psiData && pm25Data ? CACHE : NO_STORE,
  );
});
export default handler;

export async function GET(request: Request) {
  return handler(request);
}
