/**
 * Newer live feeds, served from one function to stay within Vercel's function limit:
 *   /api/live?feed=roadconditions  LTA road works on the expressways + faulty traffic lights
 *   /api/live?feed=carparks        LTA/HDB/URA car park availability
 *   /api/live?feed=weatheralerts   NEA lightning + heat stress (WBGT)
 * Each feed sets its own cache headers; the CDN caches each ?feed= separately.
 */
import { handlePreflight, sendJson } from './_client.ts';
import roadConditions from './_roadconditions.ts';
import carParks from './_carparks.ts';
import weatherAlerts from './_weatheralerts.ts';

const FEEDS: Record<string, (req: any, res?: any) => Promise<any>> = {
  roadconditions: roadConditions,
  carparks: carParks,
  weatheralerts: weatherAlerts,
};

export default async function handler(req: any, res?: any) {
  const preflight = handlePreflight(req, res);
  if (preflight) return preflight;
  const url = new URL(req.url || '/', 'http://localhost');
  const feed = FEEDS[url.searchParams.get('feed') || ''];
  if (!feed) {
    return sendJson(res, 404, { success: false, error: `Unknown feed. Use one of: ${Object.keys(FEEDS).join(', ')}` });
  }
  return feed(req, res);
}

export async function GET(request: Request) {
  return handler(request);
}
