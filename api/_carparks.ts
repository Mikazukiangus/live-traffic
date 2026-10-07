/**
 * Car park availability from LTA DataMall (LTA, HDB and URA car parks, ~6 pages).
 * Upstream: https://datamall2.mytransport.sg/ltaodataservice/CarParkAvailabilityv2
 * Returns every car park compactly so the browser picks the nearest ones itself:
 * the visitor's location is never sent here.
 */
import { fetchLtaAll, getLtaAccountKey, handlePreflight, liveCacheHeaders, sendJson } from './_client.ts';

const CARPARKS_URL = 'https://datamall2.mytransport.sg/ltaodataservice/CarParkAvailabilityv2';
// LTA updates lots every minute.
const CACHE = liveCacheHeaders(60, 120);

// Lot types: C = car, Y = motorcycle, H = heavy vehicle (S, season, is left out)
const LOT_KEY: Record<string, 'car' | 'motorcycle' | 'heavy'> = { C: 'car', Y: 'motorcycle', H: 'heavy' };

const titleCase = (s: string) =>
  s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bBlk\b/g, 'Blk');

export default async function handler(req: any, res?: any) {
  const preflight = handlePreflight(req, res);
  if (preflight) return preflight;

  const accountKey = getLtaAccountKey();
  if (!accountKey) return sendJson(res, 503, { success: false, error: 'LTA_ACCOUNT_KEY not configured' });

  try {
    const records = await fetchLtaAll(CARPARKS_URL, accountKey);
    // One entry per car park, with its lots by type.
    const byId = new Map<string, { id: string; name: string; agency: string; lat: number; lon: number; car?: number; motorcycle?: number; heavy?: number }>();
    for (const r of records) {
      const lot = LOT_KEY[r.LotType];
      const [lat, lon] = String(r.Location || '').split(' ').map(Number);
      if (!lot || !Number.isFinite(lat) || !Number.isFinite(lon) || typeof r.AvailableLots !== 'number') continue;
      const id = `${r.Agency}-${r.CarParkID}`;
      if (!byId.has(id)) {
        byId.set(id, {
          id,
          name: titleCase(String(r.Development || r.CarParkID)),
          agency: String(r.Agency),
          lat: Math.round(lat * 1e5) / 1e5,
          lon: Math.round(lon * 1e5) / 1e5,
        });
      }
      byId.get(id)![lot] = r.AvailableLots;
    }
    return sendJson(
      res,
      200,
      { success: true, source: 'lta_carparkavailabilityv2', fetchedAt: new Date().toISOString(), carParks: [...byId.values()] },
      CACHE
    );
  } catch (err: any) {
    return sendJson(res, 502, { success: false, error: 'Failed to fetch LTA car park availability', message: err?.message });
  }
}
