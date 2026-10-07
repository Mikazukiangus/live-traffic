/**
 * Health check & diagnostic endpoint for TrafficPulse LTA DataMall serverless connection.
 * Each endpoint's status comes from a live probe of its upstream source, not a static flag.
 */
import { getLtaAccountKey, liveCacheHeaders, setCorsHeaders, setHeaders } from './_client.ts';

const LTA_BASE = 'https://datamall2.mytransport.sg/ltaodataservice';
const DATA_GOV_TRAFFIC_IMAGES = 'https://api.data.gov.sg/v1/transport/traffic-images';
const NEA_TWO_HR_FORECAST = 'https://api-open.data.gov.sg/v2/real-time/api/two-hr-forecast';
const NEA_24_HR_FORECAST = 'https://api-open.data.gov.sg/v2/real-time/api/twenty-four-hr-forecast';
const NEA_PSI = 'https://api-open.data.gov.sg/v2/real-time/api/psi';
const NEA_PM25 = 'https://api-open.data.gov.sg/v2/real-time/api/pm25';
const PROBE_TIMEOUT_MS = 8000;

interface ProbeResult {
  status: 'UP' | 'DOWN';
  httpCode: number;
  latencyMs: number;
  error?: string;
}

async function probe(url: string, headers: Record<string, string> = {}): Promise<ProbeResult> {
  const start = Date.now();
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json', ...headers },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    // Drain the body so the connection is released.
    await response.arrayBuffer().catch(() => undefined);
    return {
      status: response.ok ? 'UP' : 'DOWN',
      httpCode: response.status,
      latencyMs: Date.now() - start,
      ...(response.ok ? {} : { error: `Upstream responded ${response.status}` }),
    };
  } catch (err: any) {
    return {
      status: 'DOWN',
      httpCode: 0,
      latencyMs: Date.now() - start,
      error: err?.name === 'TimeoutError' ? `Timed out after ${PROBE_TIMEOUT_MS}ms` : err?.message || 'Network error',
    };
  }
}

function missingKey(): ProbeResult {
  return { status: 'DOWN', httpCode: 401, latencyMs: 0, error: 'LTA_ACCOUNT_KEY not configured' };
}

export default async function handler(req: any, res?: any) {
  if (req && req.method === 'OPTIONS') {
    if (res && typeof res.status === 'function') {
      setCorsHeaders(res);
      return res.status(204).end();
    }
    return new Response(null, { status: 204 });
  }

  // Only the server-side environment key is checked; the key value is never echoed back.
  const accountKey = getLtaAccountKey();
  const ltaHeaders: Record<string, string> = accountKey ? { AccountKey: accountKey } : {};
  const ltaProbe = (path: string) => (accountKey ? probe(`${LTA_BASE}/${path}`, ltaHeaders) : Promise.resolve(missingKey()));

  const startTime = Date.now();
  const [incidents, images, speedBands, vms, travelTimes, rainForecast, forecast24h, psi, pm25] = await Promise.all([
    ltaProbe('TrafficIncidents'),
    accountKey ? probe(`${LTA_BASE}/Traffic-Imagesv2`, ltaHeaders) : probe(DATA_GOV_TRAFFIC_IMAGES),
    ltaProbe('v4/TrafficSpeedBands'),
    ltaProbe('VMS'),
    ltaProbe('EstTravelTimes'),
    // Keyless, so probed whether or not an LTA key is configured.
    probe(NEA_TWO_HR_FORECAST),
    probe(NEA_24_HR_FORECAST),
    probe(NEA_PSI),
    probe(NEA_PM25),
  ]);

  // /api/airquality serves whichever of PSI and PM2.5 answers, so it is UP if either is.
  const airQuality: ProbeResult = psi.status === 'UP' || pm25.status === 'UP'
    ? { status: 'UP', httpCode: 200, latencyMs: Math.max(psi.latencyMs, pm25.latencyMs) }
    : { ...psi, error: `PSI: ${psi.error}; PM2.5: ${pm25.error}` };

  const endpoints = [
    {
      path: '/api/health',
      name: 'Gateway Health & Diagnostics',
      method: 'GET',
      purpose: 'Real-time telemetry and gateway credentials validation',
      upstream: 'Internal Gateway',
      status: 'UP',
      httpCode: 200,
      latencyMs: 0,
    },
    {
      path: '/api/traffic',
      name: 'LTA Traffic Incidents',
      method: 'GET',
      purpose: 'Expressway accidents, breakdowns, flash floods, and obstacles',
      upstream: 'LTA DataMall TrafficIncidents',
      ...incidents,
    },
    {
      path: '/api/trafficimages',
      name: 'Traffic CCTV Surveillance Images',
      method: 'GET',
      purpose: 'Expressway highway surveillance live camera snapshots',
      upstream: accountKey ? 'LTA DataMall Traffic-Imagesv2' : 'LTA Data.gov.sg Live Feed',
      ...images,
    },
    {
      path: '/api/trafficflow',
      name: 'Expressway Flow & Speed Bands',
      method: 'GET',
      purpose: 'Live expressway average sensor loop speeds and congestion',
      upstream: 'LTA DataMall v4/TrafficSpeedBands',
      ...speedBands,
    },
    {
      // Aggregates the same speed bands feed, so it shares that upstream probe.
      path: '/api/expresswayspeeds',
      name: 'Expressway Speed Summary',
      method: 'GET',
      purpose: 'Average speed and congestion per expressway for Live Traffic Radar',
      upstream: 'LTA DataMall v4/TrafficSpeedBands (aggregated)',
      ...speedBands,
    },
    {
      path: '/api/vms',
      name: 'EMAS Variable Message Signs',
      method: 'GET',
      purpose: 'Overhead highway LED electronic advisory gantries',
      upstream: 'LTA DataMall VMS',
      ...vms,
    },
    {
      path: '/api/traveltimes',
      name: 'Estimated Expressway Travel Times',
      method: 'GET',
      purpose: 'Origin to destination expressway travel duration estimates',
      upstream: 'LTA DataMall EstTravelTimes',
      ...travelTimes,
    },
    {
      path: '/api/rainforecast',
      name: 'NEA 2-Hour Rain Forecast',
      method: 'GET',
      purpose: 'Rain and thunderstorm outlook for 47 areas along the expressways',
      upstream: 'data.gov.sg v2 two-hr-forecast',
      ...rainForecast,
    },
    {
      path: '/api/forecast24h',
      name: 'NEA 24-Hour Weather Forecast',
      method: 'GET',
      purpose: 'Island-wide and regional weather outlook for the next 24 hours',
      upstream: 'data.gov.sg v2 twenty-four-hr-forecast',
      ...forecast24h,
    },
    {
      path: '/api/airquality',
      name: 'NEA Air Quality (PSI & PM2.5)',
      method: 'GET',
      purpose: '24-hour PSI and 1-hour PM2.5 for the five regions',
      upstream: 'data.gov.sg v2 psi + pm25',
      ...airQuality,
    },
    {
      // The proxy only relays camera image links, so it is as healthy as the images feed.
      path: '/api/imageproxy',
      name: 'High-Throughput CCTV Image Proxy',
      method: 'GET',
      purpose: 'Bypasses browser octet-stream/nosniff MIME blocking',
      upstream: 'LTA Images CDN Proxy',
      status: images.status,
      httpCode: images.httpCode,
      latencyMs: images.latencyMs,
      ...(images.error ? { error: `Depends on images feed: ${images.error}` } : {}),
    },
  ];

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
    environment: process.env.NODE_ENV || 'production',
    ltaKeyConfigured: !!accountKey,
    providerMode: accountKey
      ? 'Official LTA DataMall Direct'
      : 'Open Transport DataMall & Public Real-time API',
    probeLatencyMs: Date.now() - startTime,
    endpoints,
  };

  // Short CDN cache so page loads don't each fan out seven upstream requests.
  const cache = liveCacheHeaders(30, 30);

  if (res && typeof res.status === 'function') {
    setCorsHeaders(res);
    res.setHeader('Content-Type', 'application/json');
    setHeaders(res, cache);
    return res.status(200).json(healthData);
  }

  return new Response(JSON.stringify(healthData), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      ...cache,
    },
  });
}

export async function GET(request: Request) {
  return handler(request);
}
