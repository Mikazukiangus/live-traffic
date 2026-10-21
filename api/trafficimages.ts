import { reportFailure, UpstreamHttpError } from '../shared/diagnostics.ts';
import { config } from '../config/server.ts';
import {
  fromDataMallCameras,
  fromPublicCameras,
  isDataMallCameras,
  isPublicCameras,
} from '../shared/traffic/cameras.ts';
import { readValidatedJson } from '../shared/traffic/validation.ts';
import { getLtaAccountKey, liveCacheHeaders, sendJson } from './_client.ts';
import { handlePreflight } from '../server/http/responses.ts';
import { fetchProvider } from '../server/http/providerFetch.ts';

// LTA captures every 1-5 minutes; the page polls every 30 seconds.
const CACHE = liveCacheHeaders(...config.server.cache.proxy);

/** Validate both official providers before publishing a normalized camera snapshot. */
export default async function handler(req: any, res?: any) {
  const preflight = handlePreflight(req, res);
  if (preflight) return preflight;
  const accountKey = getLtaAccountKey(req);
  if (accountKey) {
    try {
      const response = await fetchProvider(config.server.upstreams.images, {
        signal: AbortSignal.timeout(config.server.requestTimeoutMs),
        headers: { AccountKey: accountKey, accept: 'application/json' },
      });
      if (response.ok) {
        const data = await readValidatedJson(response, isDataMallCameras);
        return sendJson(res, 200, fromDataMallCameras(data, new Date().toISOString()), CACHE);
      }
      reportFailure('camera', undefined, response.status);
      await response.body?.cancel().catch(() => undefined);
    } catch (error) {
      reportFailure('camera', error);
      // A rejected primary snapshot may still recover through the public LTA feed.
    }
  }

  try {
    const response = await fetchProvider(config.trafficImagesUrl, {
      signal: AbortSignal.timeout(config.server.requestTimeoutMs),
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new UpstreamHttpError(response.status);
    }
    const data = await readValidatedJson(response, isPublicCameras);
    return sendJson(res, 200, fromPublicCameras(data), CACHE);
  } catch (error) {
    return sendJson(res, 502, reportFailure('camera', error));
  }
}

export async function GET(request: Request) {
  return handler(request);
}
