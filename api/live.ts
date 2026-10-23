import { providerFailureStatus, providerFailureHeaders } from '../server/http/providerFailure.ts';
import { requestSchemas } from '../server/http/requestSchemas.ts';
import { withRequestSchema } from '../server/http/validateRequest.ts';
/**
 * Newer live feeds, served from one function to stay within Vercel's function limit:
 *   /api/live?feed=roadconditions  LTA road works on the expressways + faulty traffic lights
 *   /api/live?feed=carparks        LTA/HDB/URA car park availability
 *   /api/live?feed=weatheralerts   NEA lightning + heat stress (WBGT)
 *   /api/live?feed=floods          PUB flood alerts
 * Each feed sets its own cache headers; the CDN caches each ?feed= separately.
 */
import { sendJson } from './_client.ts';
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

const handler = withRequestSchema(requestSchemas.live, async (req, res, input) => {
  try {
    const feed = FEEDS[input.query.feed];
    return await feed(req, res);
  } catch (error) {
    return sendJson(res, providerFailureStatus(error), reportFailure('gateway', error), providerFailureHeaders(error));
  }
});
export default handler;

export async function GET(request: Request) {
  return handler(request);
}
