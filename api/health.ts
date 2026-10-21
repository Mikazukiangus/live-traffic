import { requestSchemas } from '../server/http/requestSchemas.ts';
import { withRequestSchema } from '../server/http/validateRequest.ts';
import { isLtaIncidentPayload } from '../shared/traffic/incidents.ts';
import { isDataMallCameras, isPublicCameras } from '../shared/traffic/cameras.ts';
import { probe, probeDataGov, missingKey } from '../server/healthProbes.ts';
import { healthEndpoints } from '../server/healthCatalogue.ts';

import { config } from '../config/server.ts';
/**
 * Health check & diagnostic endpoint for TrafficPulse LTA DataMall serverless connection.
 * Each endpoint's status comes from a live probe of its upstream source, not a static flag.
 */
import { getLtaAccountKey, liveCacheHeaders, setHeaders } from './_client.ts';

const LTA_BASE = config.server.upstreams.ltaBase;
const DATA_GOV_TRAFFIC_IMAGES = config.trafficImagesUrl;
const NEA_TWO_HR_FORECAST = config.server.upstreams.rain;
const NEA_24_HR_FORECAST = config.server.upstreams.forecast24h;
const NEA_PSI = config.server.upstreams.psi;
const NEA_PM25 = config.server.upstreams.pm25;
const NEA_LIGHTNING = config.server.upstreams.lightning;
const NEA_WBGT = config.server.upstreams.wbgt;
const PUB_FLOOD_ALERTS = config.server.upstreams.floods;

const handler = withRequestSchema(requestSchemas.empty, async (_req, res) => {
  // Only the server-side environment key is checked; the key value is never echoed back.
  const accountKey = getLtaAccountKey();
  const ltaHeaders: Record<string, string> = accountKey ? { AccountKey: accountKey } : {};
  const ltaProbe = (path: string, validate?: (value: unknown) => boolean) =>
    accountKey ? probe(`${LTA_BASE}/${path}`, ltaHeaders, validate) : Promise.resolve(missingKey());

  const startTime = Date.now();
  const [
    incidents,
    images,
    speedBands,
    vms,
    travelTimes,
    rainForecast,
    forecast24h,
    psi,
    pm25,
    roadWorks,
    faultyLights,
    carParks,
    lightning,
    wbgt,
    floods,
  ] = await Promise.all([
    ltaProbe('TrafficIncidents', isLtaIncidentPayload),
    accountKey
      ? probe(`${LTA_BASE}/Traffic-Imagesv2`, ltaHeaders, isDataMallCameras)
      : probe(DATA_GOV_TRAFFIC_IMAGES, {}, isPublicCameras),
    ltaProbe('v4/TrafficSpeedBands'),
    ltaProbe('VMS'),
    ltaProbe('EstTravelTimes'),
    // Keyless, so probed whether or not an LTA key is configured.
    probeDataGov(NEA_TWO_HR_FORECAST),
    probeDataGov(NEA_24_HR_FORECAST),
    probeDataGov(NEA_PSI),
    probeDataGov(NEA_PM25),
    ltaProbe('RoadWorks'),
    ltaProbe('FaultyTrafficLights'),
    ltaProbe('CarParkAvailabilityv2'),
    probeDataGov(NEA_LIGHTNING),
    probeDataGov(NEA_WBGT),
    probeDataGov(PUB_FLOOD_ALERTS),
  ]);

  const endpoints = healthEndpoints(!!accountKey, {
    incidents,
    images,
    speedBands,
    vms,
    travelTimes,
    rainForecast,
    forecast24h,
    psi,
    pm25,
    roadWorks,
    faultyLights,
    carParks,
    lightning,
    wbgt,
    floods,
  });

  const upCount = endpoints.filter((ep) => ep.status === 'UP').length;

  const healthData = {
    status: upCount === endpoints.length ? 'healthy' : 'degraded',
    operational: upCount === endpoints.length,
    upCount,
    totalCount: endpoints.length,
    service: 'TrafficPulse Singapore Expressway & LTA Gateway',
    version: '2.4.0',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime ? process.uptime() : 0),
    environment: config.server.environment,
    ltaKeyConfigured: !!accountKey,
    providerMode: accountKey ? 'Official LTA DataMall Direct' : 'Open Transport DataMall & Public Real-time API',
    probeLatencyMs: Date.now() - startTime,
    endpoints,
  };

  // Short CDN cache so page loads don't each fan out seven upstream requests.
  const cache = liveCacheHeaders(...config.server.cache.health);

  if (res && typeof res.status === 'function') {
    res.setHeader('Content-Type', 'application/json');
    setHeaders(res, cache);
    return res.status(200).json(healthData);
  }

  return new Response(JSON.stringify(healthData), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      ...cache,
    },
  });
});
export default handler;

export async function GET(request: Request) {
  return handler(request);
}
