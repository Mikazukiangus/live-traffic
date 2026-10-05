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
