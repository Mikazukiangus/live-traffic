/**
 * Road works on the expressways and faulty traffic lights, from LTA DataMall.
 * Upstream: https://datamall2.mytransport.sg/ltaodataservice/RoadWorks (all roads, ~17 pages)
 *           https://datamall2.mytransport.sg/ltaodataservice/FaultyTrafficLights
 * LTA gives road works by road name only (no location or details), so they are matched to
 * expressways by name and kept if they are in progress today (Singapore date).
 */
import {
  NO_STORE,
  fetchLtaAll,
  getLtaAccountKey,
  handlePreflight,
  liveCacheHeaders,
  sendJson,
} from './_client.ts';

const LTA = 'https://datamall2.mytransport.sg/ltaodataservice';
// Road works are planned weeks ahead; traffic light faults change by the minute but are few.
// The CDN keeps the whole answer 5 minutes, so the 17-page road works list is rarely refetched.
const CACHE = liveCacheHeaders(300, 900);

// LTA road names (and tunnel variants) -> expressway code
const EXPRESSWAY_ROAD_NAMES: [RegExp, string][] = [
  [/^PAN ISLAND EXPRESSWAY/, 'PIE'],
  [/^AYER RAJAH EXPRESSWAY/, 'AYE'],
  [/^EAST COAST PARKWAY/, 'ECP'],
  [/^(CENTRAL EXPRESSWAY|CTE\b)/, 'CTE'],
  [/^TAMPINES EXPRESSWAY/, 'TPE'],
  [/^KALLANG[- ]PAYA LEBAR EXPRESSWAY/, 'KPE'],
  [/^SELETAR EXPRESSWAY/, 'SLE'],
  [/^BUKIT TIMAH EXPRESSWAY/, 'BKE'],
  [/^KRANJI EXPRESSWAY/, 'KJE'],
  [/^(MARINA COASTAL EXPRESSWAY|MCE\b)/, 'MCE'],
];

const expresswayFor = (road: string) => EXPRESSWAY_ROAD_NAMES.find(([re]) => re.test(road.toUpperCase()))?.[1];

// "2026-10-07" in Singapore
const sgToday = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

// LTA's Type code doesn't always match its own message ("Black Out" arrives as Type 2), so the
// kind of fault is read from the message.
const faultKind = (message: string) =>
  /black\s?out/i.test(message) ? 'Blackout' : /flash/i.test(message) ? 'Flashing yellow' : 'Fault';

export default async function handler(req: any, res?: any) {
  const preflight = handlePreflight(req, res);
  if (preflight) return preflight;

  const accountKey = getLtaAccountKey();
  if (!accountKey) {
    return sendJson(res, 503, { success: false, error: 'LTA_ACCOUNT_KEY not configured' });
  }

  const [works, lights] = await Promise.allSettled([
    fetchLtaAll(`${LTA}/RoadWorks`, accountKey),
    fetchLtaAll(`${LTA}/FaultyTrafficLights`, accountKey, { wave: 1, maxPages: 4 }),
  ]);
  if (works.status === 'rejected' && lights.status === 'rejected') {
    return sendJson(res, 502, {
      success: false,
      error: 'Failed to fetch LTA road conditions',
      message: `RoadWorks: ${works.reason?.message}; FaultyTrafficLights: ${lights.reason?.message}`,
    });
  }

  const today = sgToday();
  const roadWorks =
    works.status === 'fulfilled'
      ? works.value
          .map((w) => ({ w, code: expresswayFor(String(w.RoadName || '')) }))
          .filter(({ w, code }) => code && w.StartDate <= today && (!w.EndDate || w.EndDate >= today))
          .map(({ w, code }) => ({
            id: String(w.EventID),
            code: code!,
            road: String(w.RoadName),
            start: String(w.StartDate),
            end: w.EndDate ? String(w.EndDate) : null,
            by: String(w.SvcDept || ''),
          }))
          .sort((a, b) => a.code.localeCompare(b.code) || (a.end || '9').localeCompare(b.end || '9'))
      : null;

  const faultyLights =
    lights.status === 'fulfilled'
      ? lights.value.map((l) => ({
          id: String(l.AlarmID),
          kind: faultKind(String(l.Message || '')),
          since: l.StartDate ? String(l.StartDate).slice(0, 16) : null,
          // "(07/10)13:14 Black Out at JURONG EAST AVE 1 PC NR 341." -> "Black Out at JURONG EAST AVE 1 PC NR 341."
          message: String(l.Message || '').replace(/^\(\d{1,2}\/\d{1,2}\)\d{1,2}:\d{2}\s*/, ''),
        }))
      : null;

  return sendJson(
    res,
    200,
    { success: true, source: 'lta_roadworks_faultytrafficlights', date: today, roadWorks, faultyLights },
    // A partial answer is not cached, so the next request tries both feeds again.
    roadWorks && faultyLights ? CACHE : NO_STORE
  );
}
