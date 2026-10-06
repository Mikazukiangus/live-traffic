/**
 * Expressway Speed Summary Serverless Endpoint
 * Aggregates LTA DataMall v4/TrafficSpeedBands (~140k road links, 500 per page) into
 * one summary per Singapore expressway. LTA refreshes speed bands every 5 minutes,
 * so results are cached in-instance and at the CDN for that window.
 * `?include=segments` adds every expressway link's coordinates and band for map rendering.
 * Header: AccountKey: <LTA_ACCOUNT_KEY>
 */
import { getLtaAccountKey, setCorsHeaders } from './_client.ts';

const SPEED_BANDS_ENDPOINT = 'https://datamall2.mytransport.sg/ltaodataservice/v4/TrafficSpeedBands';
const PAGE_SIZE = 500;
const CONCURRENCY = 10; // LTA returns HTTP 500 when hit with ~30 parallel requests
const MAX_ATTEMPTS = 4;
const MAX_PAGES = 600; // safety stop (~300k links)
const CACHE_TTL_MS = 5 * 60 * 1000;

// LTA road names (RoadCategory 1) -> expressway code
const EXPRESSWAY_ROAD_NAMES: Record<string, string> = {
  'PAN ISLAND EXPRESSWAY': 'PIE',
  'AYER RAJAH EXPRESSWAY': 'AYE',
  'EAST COAST PARKWAY': 'ECP',
  'CENTRAL EXPRESSWAY': 'CTE',
  'TAMPINES EXPRESSWAY': 'TPE',
  'KALLANG PAYA LEBAR EXPRESSWAY': 'KPE',
  'KALLANG PAYA LEBAR EXPRESSWAY TUNNEL': 'KPE',
  'SELETAR EXPRESSWAY': 'SLE',
  'BUKIT TIMAH EXPRESSWAY': 'BKE',
  'KRANJI EXPRESSWAY': 'KJE',
  'MARINA COASTAL EXPRESSWAY': 'MCE',
};

// Representative km/h per speed band. Bands 1-7 are 10 km/h ranges (0-9 ... 60-69);
// band 8 is "70 and above" (LTA reports its max as 999), so 80 is used as its typical speed.
const BAND_SPEED_KMH: Record<number, number> = { 1: 5, 2: 15, 3: 25, 4: 35, 5: 45, 6: 55, 7: 65, 8: 80 };
const SLOW_BAND_MAX = 4; // bands 1-4 = below 40 km/h

export interface ExpresswaySpeedSummary {
  code: string;
  avgSpeedKmH: number;
  linkCount: number;
  slowLinkPct: number; // % of links below 40 km/h
  status: 'Smooth' | 'Moderate' | 'Heavy' | 'Congested';
  bandCounts: Record<string, number>;
}

// Compact map segment: [code, band, startLon, startLat, endLon, endLat]
export type SpeedSegment = [string, number, number, number, number, number];

// Drive from the expressway to each land checkpoint towards Johor, Singapore side only.
// Each route is traced backwards along mainline links (RoadCategory 1) from the checkpoint end.
interface CheckpointRoute {
  id: 'woodlands' | 'tuas';
  name: string;
  via: string;
  road: string;
  heading: (l: RouteLink) => boolean; // links in the direction of travel
  endScore: (l: RouteLink) => number; // highest score = link reaching the checkpoint
  stop: (l: RouteLink) => boolean; // trace start reached
}

// [startLon, startLat, endLon, endLat, band]; band 0 = no reading
type RouteLink = [number, number, number, number, number];

export const CHECKPOINT_ROUTES: CheckpointRoute[] = [
  {
    id: 'woodlands',
    name: 'Woodlands Checkpoint',
    via: 'BKE northbound from PIE, up to the checkpoint slip roads',
    road: 'BUKIT TIMAH EXPRESSWAY',
    heading: (l) => l[3] > l[1],
    endScore: (l) => l[3],
    stop: () => false, // whole BKE
  },
  {
    id: 'tuas',
    name: 'Tuas Checkpoint',
    via: 'last 6 km of AYE westbound, up to the booths',
    road: 'AYER RAJAH EXPRESSWAY',
    heading: (l) => l[2] < l[0],
    endScore: (l) => -l[2],
    stop: (l) => l[0] > 103.68,
  },
];

// Near the checkpoint, report the average speed over this distance as the queue reading.
const QUEUE_KM = 1;

// The AYE ends inside Tuas Checkpoint; links through the immigration booths always read slow
// because every vehicle stops. The estimate covers the drive up to the booths, so they're excluded.
// Keep in sync with src/utils/expresswaySpeeds.ts.
const BOOTH_ZONES = [{ minLat: 1.3463, maxLat: 1.35, minLon: 103.634, maxLon: 103.6385 }];
const inBoothZone = (l: RouteLink) => {
  const lat = (l[1] + l[3]) / 2;
  const lon = (l[0] + l[2]) / 2;
  return BOOTH_ZONES.some((z) => lat >= z.minLat && lat <= z.maxLat && lon >= z.minLon && lon <= z.maxLon);
};

export interface CheckpointApproach {
  id: CheckpointRoute['id'];
  name: string;
  via: string;
  km: number;
  minutes: number; // using typical band speeds
  minMinutes: number; // every link at the top of its band
  maxMinutes: number; // every link at the bottom of its band (5 km/h floor)
  queueSpeedKmH: number | null; // average over the last QUEUE_KM before the checkpoint
}

const linkKm = (l: RouteLink) =>
  Math.hypot((l[1] - l[3]) * 111.32, (l[0] - l[2]) * 111.32 * Math.cos((1.35 * Math.PI) / 180));
const linkHeading = (l: RouteLink) => Math.atan2(l[3] - l[1], (l[2] - l[0]) * Math.cos((1.35 * Math.PI) / 180));
const pointKey = (lon: number, lat: number) => `${lon.toFixed(4)},${lat.toFixed(4)}`;

export function traceCheckpoint(route: CheckpointRoute, allLinks: RouteLink[]): CheckpointApproach | null {
  const links = allLinks.filter((l) => !inBoothZone(l));
  const candidates = links.filter(route.heading);
  if (candidates.length === 0) return null;
  const byEnd = new Map<string, RouteLink[]>();
  for (const l of links) {
    const k = pointKey(l[2], l[3]);
    byEnd.set(k, [...(byEnd.get(k) || []), l]);
  }

  // Walk back from the checkpoint; at merges follow the link heading most like the current one.
  let current = candidates.reduce((a, b) => (route.endScore(b) > route.endScore(a) ? b : a));
  const path = [current];
  const seen = new Set([current]);
  while (!route.stop(current)) {
    const preds = (byEnd.get(pointKey(current[0], current[1])) || []).filter((p) => !seen.has(p));
    if (preds.length === 0) break;
    const h = linkHeading(current);
    const turn = (p: RouteLink) => Math.abs(Math.atan2(Math.sin(linkHeading(p) - h), Math.cos(linkHeading(p) - h)));
    current = preds.reduce((a, b) => (turn(b) < turn(a) ? b : a));
    seen.add(current);
    path.push(current);
  }

  let km = 0, knownKm = 0, typical = 0, fast = 0, slow = 0;
  let queueKm = 0, queueHours = 0;
  for (const l of path) {
    const len = linkKm(l);
    km += len;
    const band = l[4];
    if (!BAND_SPEED_KMH[band]) continue;
    knownKm += len;
    typical += len / BAND_SPEED_KMH[band];
    fast += len / (band === 8 ? 90 : band * 10);
    slow += len / (band === 8 ? 70 : Math.max(5, (band - 1) * 10));
    // path[0] touches the checkpoint, so the first links walked make up the queue stretch
    if (queueKm < QUEUE_KM) {
      queueKm += len;
      queueHours += len / BAND_SPEED_KMH[band];
    }
  }
  if (knownKm < km * 0.7) return null; // too many links without a reading
  const scale = km / knownKm; // links without a reading are assumed to move at the average pace
  const toMinutes = (hours: number) => Math.round(hours * scale * 60);
  return {
    id: route.id,
    name: route.name,
    via: route.via,
    km: Math.round(km * 10) / 10,
    minutes: toMinutes(typical),
    minMinutes: toMinutes(fast),
    maxMinutes: toMinutes(slow),
    queueSpeedKmH: queueHours > 0 ? Math.round(queueKm / queueHours) : null,
  };
}

let cache: { expiresAt: number; payload: any; segments: SpeedSegment[] } | null = null;

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;
// Rough Singapore bounds, to drop links with missing/zero coordinates.
const inSingapore = (lon: number, lat: number) => lon > 103.5 && lon < 104.2 && lat > 1.1 && lat < 1.5;

async function fetchPage(skip: number, accountKey: string): Promise<{ value: any[]; lastUpdatedTime?: string }> {
  let lastError = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(`${SPEED_BANDS_ENDPOINT}?$skip=${skip}`, {
        headers: { AccountKey: accountKey, accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      if (response.ok) {
        const data = await response.json();
        return { value: data.value || [], lastUpdatedTime: data.lastUpdatedTime };
      }
      lastError = `LTA responded ${response.status} at $skip=${skip}`;
    } catch (err: any) {
      lastError = err?.message || `Network error at $skip=${skip}`;
    }
    // Back off before retrying; LTA throttles bursts.
    if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 400 * attempt));
  }
  throw new Error(lastError);
}

function statusFromSlowShare(slowPct: number): ExpresswaySpeedSummary['status'] {
  if (slowPct < 10) return 'Smooth';
  if (slowPct < 20) return 'Moderate';
  if (slowPct < 35) return 'Heavy';
  return 'Congested';
}

async function buildSummary(accountKey: string) {
  const bandsByCode: Record<string, number[]> = {};
  const segments: SpeedSegment[] = [];
  const routeLinks: Record<string, RouteLink[]> = {};
  let lastUpdatedTime: string | undefined;
  let pagesFetched = 0;
  let totalLinks = 0;
  let done = false;

  // Total page count isn't advertised, so fetch in parallel waves until a short page appears.
  for (let wave = 0; !done && wave * CONCURRENCY < MAX_PAGES; wave++) {
    const skips = Array.from({ length: CONCURRENCY }, (_, i) => (wave * CONCURRENCY + i) * PAGE_SIZE);
    const pages = await Promise.all(skips.map((skip) => fetchPage(skip, accountKey)));

    for (const page of pages) {
      pagesFetched++;
      totalLinks += page.value.length;
      lastUpdatedTime ??= page.lastUpdatedTime;
      if (page.value.length < PAGE_SIZE) done = true;

      for (const link of page.value) {
        if (String(link.RoadCategory) === '1' && CHECKPOINT_ROUTES.some((r) => r.road === link.RoadName)) {
          const coords = [link.StartLon, link.StartLat, link.EndLon, link.EndLat].map(Number);
          if (coords.every(Number.isFinite)) {
            (routeLinks[link.RoadName] ??= []).push([...coords, Number(link.SpeedBand) || 0] as RouteLink);
          }
        }
        const code = EXPRESSWAY_ROAD_NAMES[link.RoadName];
        const band = Number(link.SpeedBand);
        if (code && BAND_SPEED_KMH[band]) {
          (bandsByCode[code] ??= []).push(band);
          const [sLon, sLat, eLon, eLat] = [link.StartLon, link.StartLat, link.EndLon, link.EndLat].map(Number);
          if (inSingapore(sLon, sLat) && inSingapore(eLon, eLat)) {
            segments.push([code, band, round5(sLon), round5(sLat), round5(eLon), round5(eLat)]);
          }
        }
      }
    }
  }

  const expressways: ExpresswaySpeedSummary[] = Object.entries(bandsByCode).map(([code, bands]) => {
    const bandCounts: Record<string, number> = {};
    for (const b of bands) bandCounts[b] = (bandCounts[b] || 0) + 1;
    const avg = bands.reduce((sum, b) => sum + BAND_SPEED_KMH[b], 0) / bands.length;
    const slowLinkPct = Math.round((bands.filter((b) => b <= SLOW_BAND_MAX).length / bands.length) * 100);
    return {
      code,
      avgSpeedKmH: Math.round(avg),
      linkCount: bands.length,
      slowLinkPct,
      status: statusFromSlowShare(slowLinkPct),
      bandCounts,
    };
  });

  const payload = {
    success: true,
    source: 'lta_datamall_v4_speedbands',
    lastUpdatedTime: lastUpdatedTime || null, // LTA timestamp, SGT
    generatedAt: new Date().toISOString(),
    pagesFetched,
    totalLinks,
    expressways,
    checkpoints: CHECKPOINT_ROUTES.map((r) => traceCheckpoint(r, routeLinks[r.road] || [])).filter(Boolean),
  };
  return { payload, segments };
}

function wantsSegments(req: any): boolean {
  if (req?.query?.include) return String(req.query.include).split(',').includes('segments');
  const query = typeof req?.url === 'string' && req.url.includes('?') ? req.url.split('?')[1] : '';
  return (new URLSearchParams(query).get('include') || '').split(',').includes('segments');
}

export default async function handler(req: any, res?: any) {
  if (req && req.method === 'OPTIONS') {
    if (res && typeof res.status === 'function') {
      setCorsHeaders(res);
      return res.status(204).end();
    }
    return new Response(null, { status: 204 });
  }

  const send = (status: number, body: any, cacheControl: string) => {
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
  };

  const accountKey = getLtaAccountKey();
  if (!accountKey) {
    return send(401, { success: false, error: 'LTA_ACCOUNT_KEY not configured' }, 'no-store');
  }

  try {
    if (!cache || Date.now() > cache.expiresAt) {
      const { payload, segments } = await buildSummary(accountKey);
      cache = { expiresAt: Date.now() + CACHE_TTL_MS, payload, segments };
    }
    const body = wantsSegments(req) ? { ...cache.payload, segments: cache.segments } : cache.payload;
    return send(200, body, 'public, max-age=0, s-maxage=300, stale-while-revalidate=600');
  } catch (err: any) {
    return send(502, { success: false, error: 'Failed to aggregate LTA speed bands', message: err?.message }, 'no-store');
  }
}

export async function GET(request: Request) {
  return handler(request);
}
