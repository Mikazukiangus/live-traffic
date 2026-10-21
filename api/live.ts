/**
 * Newer live feeds, served from one function to stay within Vercel's function limit:
 *   /api/live?feed=roadconditions  LTA road works on the expressways + faulty traffic lights
 *   /api/live?feed=carparks        LTA/HDB/URA car park availability
 *   /api/live?feed=weatheralerts   NEA lightning + heat stress (WBGT)
 *   /api/live?feed=floods          PUB flood alerts
 * Each feed sets its own cache headers; the CDN caches each ?feed= separately.
 */
import { handlePreflight, sendJson } from './_client.ts';
import { reportFailure } from '../shared/diagnostics.ts';
import roadConditions from './_roadconditions.ts';
import carParks from './_carparks.ts';
import weatherAlerts from './_weatheralerts.ts';
import floods from './_floods.ts';

const FEEDS: Record<string, (req: any, res?: any) => Promise<any>> = {
  roadconditions: roadConditions,
  carparks: carParks,
  weatheralerts: weatherAlerts,
  floods,
};

export default async function handler(req: any, res?: any) {
  const preflight = handlePreflight(req, res);
  if (preflight) return preflight;
  try {
    const url = new URL(req.url || '/', 'https://localhost');
    const name = url.searchParams.get('feed') || '';
    const feed = Object.hasOwn(FEEDS, name) ? FEEDS[name] : undefined;
    if (!feed) {
      return sendJson(res, 404, { success: false, error: 'Unknown feed. Use roadconditions, carparks, weatheralerts or floods.' });
    }
    return await feed(req, res);
  } catch (error) {
    return sendJson(res, 502, reportFailure('gateway', error));
  }
}

export async function GET(request: Request) {
  return handler(request);
}
