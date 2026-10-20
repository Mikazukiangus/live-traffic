import { HEALTH_FEEDS, HEALTH_PATHS } from '../shared/healthCatalogue.ts';
import type { ProbeResult } from './healthProbes.ts';
export function healthEndpoints(
  accountKeyConfigured: boolean,
  {
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
  }: Record<
    | 'incidents'
    | 'images'
    | 'speedBands'
    | 'vms'
    | 'travelTimes'
    | 'rainForecast'
    | 'forecast24h'
    | 'psi'
    | 'pm25'
    | 'roadWorks'
    | 'faultyLights'
    | 'carParks'
    | 'lightning'
    | 'wbgt'
    | 'floods',
    ProbeResult
  >,
) {
  // /api/airquality serves whichever of PSI and PM2.5 answers, so it is UP if either is.
  const airQuality: ProbeResult =
    psi.status === 'UP' || pm25.status === 'UP'
      ? { status: 'UP', httpCode: 200, latencyMs: Math.max(psi.latencyMs, pm25.latencyMs) }
      : { ...psi, error: `PSI: ${psi.error}; PM2.5: ${pm25.error}` };

  // Endpoints that combine two feeds serve whichever answers, so they are UP if either is.
  const either = (a: ProbeResult, b: ProbeResult, names: [string, string]): ProbeResult =>
    a.status === 'UP' || b.status === 'UP'
      ? { status: 'UP', httpCode: 200, latencyMs: Math.max(a.latencyMs, b.latencyMs) }
      : { ...a, error: `${names[0]}: ${a.error}; ${names[1]}: ${b.error}` };

  const endpoints = [
    {
      path: HEALTH_PATHS.health,
      name: 'Gateway Health & Diagnostics',
      method: 'GET',
      purpose: 'Real-time telemetry and gateway credentials validation',
      upstream: 'Internal Gateway',
      status: 'UP',
      httpCode: 200,
      latencyMs: 0,
    },
    {
      path: HEALTH_PATHS.traffic,
      name: 'LTA Traffic Incidents',
      method: 'GET',
      purpose: 'Expressway accidents, breakdowns, flash floods, and obstacles',
      upstream: 'LTA DataMall TrafficIncidents',
      ...incidents,
    },
    {
      path: HEALTH_PATHS.trafficimages,
      name: 'Traffic CCTV Surveillance Images',
      method: 'GET',
      purpose: 'Expressway highway surveillance live camera snapshots',
      upstream: accountKeyConfigured ? 'LTA DataMall Traffic-Imagesv2' : 'LTA Data.gov.sg Live Feed',
      ...images,
    },
    {
      path: HEALTH_PATHS.trafficflow,
      name: 'Expressway Flow & Speed Bands',
      method: 'GET',
      purpose: 'Live expressway average sensor loop speeds and congestion',
      upstream: 'LTA DataMall v4/TrafficSpeedBands',
      ...speedBands,
    },
    {
      // Aggregates the same speed bands feed, so it shares that upstream probe.
      path: HEALTH_PATHS.expresswayspeeds,
      name: 'Expressway Speed Summary',
      method: 'GET',
      purpose: 'Average speed and congestion per expressway for Live Traffic Radar',
      upstream: 'LTA DataMall v4/TrafficSpeedBands (aggregated)',
      ...speedBands,
    },
    {
      path: HEALTH_PATHS.vms,
      name: 'EMAS Variable Message Signs',
      method: 'GET',
      purpose: 'Overhead highway LED electronic advisory gantries',
      upstream: 'LTA DataMall VMS',
      ...vms,
    },
    {
      path: HEALTH_PATHS.traveltimes,
      name: 'Estimated Expressway Travel Times',
      method: 'GET',
      purpose: 'Origin to destination expressway travel duration estimates',
      upstream: 'LTA DataMall EstTravelTimes',
      ...travelTimes,
    },
    {
      path: HEALTH_PATHS.rainforecast,
      name: 'NEA 2-Hour Rain Forecast',
      method: 'GET',
      purpose: 'Rain and thunderstorm outlook for 47 areas along the expressways',
      upstream: 'data.gov.sg v2 two-hr-forecast',
      ...rainForecast,
    },
    {
      path: HEALTH_PATHS.forecast24h,
      name: 'NEA 24-Hour Weather Forecast',
      method: 'GET',
      purpose: 'Island-wide and regional weather outlook for the next 24 hours',
      upstream: 'data.gov.sg v2 twenty-four-hr-forecast',
      ...forecast24h,
    },
    {
      path: HEALTH_PATHS.airquality,
      name: 'NEA Air Quality (PSI & PM2.5)',
      method: 'GET',
      purpose: '24-hour PSI and 1-hour PM2.5 for the five regions',
      upstream: 'data.gov.sg v2 psi + pm25',
      ...airQuality,
    },
    {
      path: HEALTH_PATHS.roadconditions,
      name: 'Road Works & Faulty Traffic Lights',
      method: 'GET',
      purpose: 'Road works in progress on each expressway, and traffic light faults',
      upstream: 'LTA DataMall RoadWorks + FaultyTrafficLights',
      ...either(roadWorks, faultyLights, ['RoadWorks', 'FaultyTrafficLights']),
    },
    {
      path: HEALTH_PATHS.carparks,
      name: 'Car Park Availability',
      method: 'GET',
      purpose: 'Available car, motorcycle and heavy vehicle lots at LTA, HDB and URA car parks',
      upstream: 'LTA DataMall CarParkAvailabilityv2',
      ...carParks,
    },
    {
      path: HEALTH_PATHS.weatheralerts,
      name: 'NEA Lightning & Heat Stress',
      method: 'GET',
      purpose: 'Recent lightning strikes and WBGT heat stress by station',
      upstream: 'data.gov.sg v2 weather lightning + wbgt',
      ...either(lightning, wbgt, ['Lightning', 'WBGT']),
    },
    {
      path: HEALTH_PATHS.floods,
      name: 'PUB Flood Alerts',
      method: 'GET',
      purpose: 'Active flood alerts and the area each one covers',
      upstream: 'data.gov.sg v2 weather flood-alerts',
      ...floods,
    },
    {
      // The proxy only relays camera image links, so it is as healthy as the images feed.
      path: HEALTH_PATHS.imageproxy,
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

  // Validate identity correspondence locally; never take endpoint names from providers.
  if (endpoints.length !== HEALTH_FEEDS.length || endpoints.some((ep, i) => ep.path !== HEALTH_FEEDS[i][0]))
    throw new Error('Health catalogue mismatch');
  return endpoints;
}
