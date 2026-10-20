import { BAND_SPEED_KMH } from '../../shared/traffic/rules.ts';
import type { SpeedPayload, SpeedSegment, ExpresswaySpeedSummary } from '../../shared/traffic/types.ts';
import { CHECKPOINT_ROUTES, traceCheckpoint, type RouteLink } from './traceCheckpoint.ts';
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

const SLOW_BAND_MAX = 4;
function statusFromSlowShare(slowPct: number): ExpresswaySpeedSummary['status'] {
  if (slowPct < 10) return 'Smooth';
  if (slowPct < 20) return 'Moderate';
  if (slowPct < 35) return 'Heavy';
  return 'Congested';
}

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;
// Rough Singapore bounds, to drop links with missing/zero coordinates.
const inSingapore = (lon: number, lat: number) => lon > 103.5 && lon < 104.2 && lat > 1.1 && lat < 1.5;

/** Incremental accumulation keeps raw provider pages out of the cache. */
export function createSpeedAccumulator() {
  const bandsByCode: Record<string, number[]> = {};
  const segments: SpeedSegment[] = [];
  const routeLinks: Record<string, RouteLink[]> = {};
  const add = (links: Record<string, unknown>[]) => {
    for (const link of links) {
      if (String(link.RoadCategory) === '1' && CHECKPOINT_ROUTES.some((r) => r.road === link.RoadName)) {
        const coords = [link.StartLon, link.StartLat, link.EndLon, link.EndLat].map(Number);
        if (coords.every(Number.isFinite)) {
          (routeLinks[String(link.RoadName)] ??= []).push([...coords, Number(link.SpeedBand) || 0] as RouteLink);
        }
      }
      const code = EXPRESSWAY_ROAD_NAMES[String(link.RoadName)];
      const band = Number(link.SpeedBand);
      if (code && BAND_SPEED_KMH[band]) {
        (bandsByCode[code] ??= []).push(band);
        const [sLon, sLat, eLon, eLat] = [link.StartLon, link.StartLat, link.EndLon, link.EndLat].map(Number);
        if (inSingapore(sLon, sLat) && inSingapore(eLon, eLat)) {
          segments.push([code, band, round5(sLon), round5(sLat), round5(eLon), round5(eLat)]);
        }
      }
    }
  };
  const finish = (pagesFetched: number, totalLinks: number, lastUpdatedTime?: string) => {
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

    const payload: SpeedPayload = {
      success: true,
      source: 'lta_datamall_v4_speedbands',
      lastUpdatedTime: lastUpdatedTime || null, // LTA timestamp, SGT
      generatedAt: new Date().toISOString(),
      pagesFetched,
      totalLinks,
      expressways,
      checkpoints: CHECKPOINT_ROUTES.map((r) => traceCheckpoint(r, routeLinks[r.road] || [])).filter((c) => c !== null),
    };
    return { payload, segments };
  };
  return { add, finish };
}
