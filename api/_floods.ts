/**
 * PUB flood alerts (keyless), via data.gov.sg.
 * Upstream: https://api-open.data.gov.sg/v2/real-time/api/weather/flood-alerts?date=YYYY-MM-DD
 *
 * The feed is a heartbeat every ~2 minutes, newest first, 25 records a page; most records have no
 * readings. An Alert record's readings each carry a headline, severity and an area circle
 * ([lat, lon, radius km]); a Cancel record ends an earlier Alert through `references`
 * ("sender,identifier,sentTime"). PUB doesn't always send a Cancel, so an alert lapses after an hour.
 */
import { NO_STORE, fetchDataGovV2, handlePreflight, liveCacheHeaders, sendJson } from './_client.ts';

const FLOOD_URL = 'https://api-open.data.gov.sg/v2/real-time/api/weather/flood-alerts';
const CACHE = liveCacheHeaders(120, 300);
// An alert lasts up to an hour, so records from the last 75 minutes are enough; two pages cover it.
const LOOKBACK_MS = 75 * 60_000;
const MAX_PAGES = 2;
export const FLOOD_ALERT_LIFETIME_MS = 60 * 60_000;

export interface FloodAlert {
  id: string;
  headline: string;
  description: string;
  area: string;
  severity: string;
  lat: number;
  lon: number;
  radiusKm: number;
  // ISO times
  startsAt: string;
  endsAt: string;
}

/** Active alerts at `now` from flood-alert records (any order). */
export function activeFloodAlerts(records: any[], now: number): FloodAlert[] {
  const alerts = new Map<string, FloodAlert & { startMs: number; endMs: number | null }>();
  const cancels: { refId: string; t: number }[] = [];
  for (const rec of [...records].sort((a, b) => Date.parse(a?.datetime) - Date.parse(b?.datetime))) {
    const item = rec?.item || {};
    const readings: any[] = Array.isArray(item.readings) ? item.readings : [];
    const t = Date.parse(rec?.datetime);
    if (!Number.isFinite(t)) continue;
    const msgType = item.msgType || 'Alert';
    const id = String(item.identifier || rec.datetime);
    if (msgType === 'Cancel') {
      const refId = String(item.references || '').split(',').map((s) => s.trim())[1];
      if (refId) cancels.push({ refId, t });
      continue;
    }
    if (msgType !== 'Alert' && msgType !== 'Update') continue;
    readings.forEach((r, i) => {
      const [lat, lon, radiusKm] = (Array.isArray(r?.area?.circle) ? r.area.circle : []).map((v: unknown) => parseFloat(String(v)));
      if (![lat, lon, radiusKm].every(Number.isFinite)) return;
      alerts.set(`${id}#${i}`, {
        id: `${id}#${i}`,
        headline: String(r.headline || 'Flood alert').trim(),
        description: String(r.description || '').replace(/\s+/g, ' ').trim(),
        area: String(r.area?.areaDesc || '').trim(),
        severity: String(r.severity || ''),
        lat,
        lon,
        radiusKm,
        startsAt: new Date(t).toISOString(),
        endsAt: '',
        startMs: t,
        endMs: null,
      });
    });
  }
  for (const { refId, t } of cancels) {
    for (const a of alerts.values()) {
      if (a.id.startsWith(`${refId}#`) && t >= a.startMs && (a.endMs == null || t < a.endMs)) a.endMs = t;
    }
  }
  return [...alerts.values()]
    .map(({ startMs, endMs, ...a }) => ({ ...a, endMs: endMs ?? startMs + FLOOD_ALERT_LIFETIME_MS, startMs }))
    .filter((a) => a.startMs <= now && now < a.endMs)
    .sort((a, b) => b.startMs - a.startMs)
    .map(({ startMs, endMs, ...a }) => ({ ...a, endsAt: new Date(endMs).toISOString() }));
}

// YYYY-MM-DD in Singapore
const sgtDate = (ms: number) => new Date(ms + 8 * 3600_000).toISOString().slice(0, 10);

async function recentRecords(now: number) {
  const cutoff = now - LOOKBACK_MS;
  const dates = [...new Set([sgtDate(cutoff), sgtDate(now)])].reverse();
  const records: any[] = [];
  let latest: string | null = null;
  for (const date of dates) {
    let token: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = `${FLOOD_URL}?date=${date}${token ? `&paginationToken=${encodeURIComponent(token)}` : ''}`;
      const data = await fetchDataGovV2(url);
      const recs: any[] = data.records || [];
      records.push(...recs);
      latest ||= recs[0]?.datetime || null;
      token = data.paginationToken || null;
      const oldest = recs.length ? Date.parse(recs[recs.length - 1].datetime) : 0;
      if (!token || !recs.length || oldest < cutoff) break;
    }
    if (records.length && Date.parse(records[records.length - 1].datetime) < cutoff) break;
  }
  return { records, latest };
}

export default async function handler(req: any, res?: any) {
  const preflight = handlePreflight(req, res);
  if (preflight) return preflight;
  try {
    const now = Date.now();
    const { records, latest } = await recentRecords(now);
    return sendJson(res, 200, { success: true, source: 'pub_flood_alerts', checkedAt: latest, alerts: activeFloodAlerts(records, now) }, CACHE);
  } catch (err: any) {
    return sendJson(res, 502, { success: false, error: 'Failed to fetch PUB flood alerts', message: err?.message }, NO_STORE);
  }
}
