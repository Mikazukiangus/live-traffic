/**
 * NEA lightning and heat stress (keyless).
 * Upstream: https://api-open.data.gov.sg/v2/real-time/api/weather?api=lightning
 *           https://api-open.data.gov.sg/v2/real-time/api/weather?api=wbgt
 * Lightning: strikes in NEA's latest observation (every few minutes).
 * Heat stress: Wet Bulb Globe Temperature (WBGT) and NEA's Low / Moderate / High per station.
 */
import { NO_STORE, fetchDataGovV2, handlePreflight, liveCacheHeaders, sendJson } from './_client.ts';

const LIGHTNING_URL = 'https://api-open.data.gov.sg/v2/real-time/api/weather?api=lightning';
const WBGT_URL = 'https://api-open.data.gov.sg/v2/real-time/api/weather?api=wbgt';
const CACHE = liveCacheHeaders(120, 300);

const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};

export default async function handler(req: any, res?: any) {
  const preflight = handlePreflight(req, res);
  if (preflight) return preflight;

  const [lightning, wbgt] = await Promise.allSettled([fetchDataGovV2(LIGHTNING_URL), fetchDataGovV2(WBGT_URL)]);
  if (lightning.status === 'rejected' && wbgt.status === 'rejected') {
    return sendJson(res, 502, {
      success: false,
      error: 'Failed to fetch NEA lightning and heat stress',
      message: `Lightning: ${lightning.reason?.message}; WBGT: ${wbgt.reason?.message}`,
    });
  }

  const lightningRecord = lightning.status === 'fulfilled' ? lightning.value.records?.[0] : null;
  const strikes = lightningRecord
    ? (lightningRecord.item?.readings || [])
        .map((r: any) => ({
          lat: num(r.location?.latitude),
          // NEA spells it "longtitude" in this feed
          lon: num(r.location?.longitude ?? r.location?.longtitude),
          time: r.datetime || null,
        }))
        .filter((s: any) => s.lat != null && s.lon != null)
    : null;

  const wbgtRecord = wbgt.status === 'fulfilled' ? wbgt.value.records?.[0] : null;
  const heatStations = wbgtRecord
    ? (wbgtRecord.item?.readings || [])
        .map((r: any) => ({
          id: String(r.station?.id || ''),
          name: String(r.station?.townCenter || r.station?.name || ''),
          lat: num(r.location?.latitude),
          lon: num(r.location?.longitude),
          wbgt: num(r.wbgt),
          heatStress: String(r.heatStress || ''),
        }))
        .filter((s: any) => s.lat != null && s.lon != null && s.wbgt != null)
    : null;

  return sendJson(
    res,
    200,
    {
      success: true,
      source: 'nea_lightning_wbgt',
      lightningAt: lightningRecord?.datetime ?? null,
      strikes,
      heatAt: wbgtRecord?.datetime ?? null,
      heatStations,
    },
    strikes && heatStations ? CACHE : NO_STORE
  );
}
