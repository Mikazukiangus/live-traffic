import { providerFailureStatus, providerFailureHeaders } from '../server/http/providerFailure.ts';
import { requestSchemas } from '../server/http/requestSchemas.ts';
import { withRequestSchema } from '../server/http/validateRequest.ts';
import { reportFailure } from '../shared/diagnostics.ts';
import { config } from '../config/server.ts';
import {
  fromDataMallCameras,
  fromPublicCameras,
  isDataMallCameras,
  isPublicCameras,
} from '../shared/traffic/cameras.ts';
import { readValidatedJson } from '../shared/traffic/validation.ts';
import { getLtaAccountKey, liveCacheHeaders, sendJson } from './_client.ts';
import { readProvider } from '../server/http/readProvider.ts';

// LTA captures every 1-5 minutes; the page polls every 30 seconds.
const CACHE = liveCacheHeaders(...config.server.cache.proxy);

/** Validate both official providers before publishing a normalized camera snapshot. */
const handler = withRequestSchema(requestSchemas.empty, async (_req, res, input) => {
  const accountKey = getLtaAccountKey() ?? input.accountKey;
  if (accountKey) {
    try {
      const data = await readProvider(config.server.upstreams.images,
        (response) => readValidatedJson(response, isDataMallCameras),
        { headers: { AccountKey: accountKey, accept: 'application/json' } },
        { attempts: Math.min(2, config.server.lta.attempts) });
      return sendJson(res, 200, fromDataMallCameras(data, new Date().toISOString()), CACHE);
    } catch (error) {
      reportFailure('camera', error);
      // A rejected primary snapshot may still recover through the public LTA feed.
    }
  }

  try {
    const data = await readProvider(config.trafficImagesUrl,
      (response) => readValidatedJson(response, isPublicCameras),
      { headers: { accept: 'application/json' } }, { attempts: Math.min(2, config.server.lta.attempts) });
    return sendJson(res, 200, fromPublicCameras(data), CACHE);
  } catch (error) {
    return sendJson(res, providerFailureStatus(error), reportFailure('camera', error), providerFailureHeaders(error));
  }
});
export default handler;

export async function GET(request: Request) {
  return handler(request);
}
