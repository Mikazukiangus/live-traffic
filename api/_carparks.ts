import { providerFailureStatus, providerFailureHeaders } from '../server/http/providerFailure.ts';
import { internalFeedSchema } from '../server/http/requestSchemas.ts';
import { withRequestSchema } from '../server/http/validateRequest.ts';
import { reportFailure } from '../shared/diagnostics.ts';
import { ltaSnapshots } from '../server/cache/ltaSnapshots.ts';
import { snapshotCacheHeaders } from '../server/http/responses.ts';
import { config } from '../config/server.ts';
/**
 * Car park availability from LTA DataMall (LTA, HDB and URA car parks, ~6 pages).
 * Upstream: https://datamall2.mytransport.sg/ltaodataservice/CarParkAvailabilityv2
 * Returns every car park compactly so the browser picks the nearest ones itself:
 * the visitor's location is never sent here.
 */
import { getLtaAccountKey, sendJson } from './_client.ts';

const CARPARKS_URL = config.server.upstreams.carParks;
// LTA updates lots every minute.

// Lot types: C = car, Y = motorcycle, H = heavy vehicle (S, season, is left out)
const LOT_KEY: Record<string, 'car' | 'motorcycle' | 'heavy'> = { C: 'car', Y: 'motorcycle', H: 'heavy' };

const titleCase = (s: string) =>
  s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bBlk\b/g, 'Blk');

const handler = withRequestSchema(internalFeedSchema('carparks'), async (_req, res) => {
  const accountKey = getLtaAccountKey();
  if (!accountKey) return sendJson(res, 503, { success: false, error: 'LTA_ACCOUNT_KEY not configured' });

  try {
    const snapshot = await ltaSnapshots.get(CARPARKS_URL, accountKey, config.server.snapshotCache.carParksMs);
    const records = snapshot.value;
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
      { success: true, source: 'lta_carparkavailabilityv2', fetchedAt: new Date(snapshot.storedAt).toISOString(), carParks: [...byId.values()] },
      snapshotCacheHeaders(snapshot.expiresAt, config.server.cache.carParks)
    );
  } catch (err: any) {
    return sendJson(res, providerFailureStatus(err), reportFailure('lta', err), providerFailureHeaders(err));
  }
});
export default handler;
