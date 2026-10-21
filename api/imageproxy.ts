import { requestSchemas } from '../server/http/requestSchemas.ts';
import { withRequestSchema } from '../server/http/validateRequest.ts';
import { reportFailure, UpstreamHttpError } from '../shared/diagnostics.ts';
import { config } from '../config/server.ts';
import { fetchProvider } from '../server/http/providerFetch.ts';
/**
 * Serverless Image Proxy for Singapore LTA and Open Data Traffic Images.
 * Fixes browser MIME-type blocking (x-content-type-options: nosniff on application/octet-stream)
 * by proxying the image and serving with correct image/jpeg headers and caching.
 */
import { sendJson, setHeaders } from './_client.ts';

// LTA DataMall camera images are S3 links without CORS headers; proxying them lets the
// browser read pixels for vehicle counting.
// Each LTA image link is unique per capture (and expires after 15 minutes), so the photo
// behind a URL never changes: browsers and Vercel's CDN can both keep it for that long.
const IMAGE_CACHE = {
  'Cache-Control': `public, max-age=${config.server.imageCacheSeconds}`,
  'Vercel-CDN-Cache-Control': `max-age=${config.server.imageCacheSeconds}`,
};

const handler = withRequestSchema(requestSchemas.image, async (_req, res, input) => {
  const { imageUrl } = input.query;

  try {
    const response = await fetchProvider(imageUrl, {
      signal: AbortSignal.timeout(config.server.requestTimeoutMs),
      headers: {
        accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
    });

    if (!response.ok) {
      throw new UpstreamHttpError(response.status);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (res && typeof res.status === 'function') {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Access-Control-Allow-Origin', config.server.corsOrigin);
      setHeaders(res, IMAGE_CACHE);
      res.statusCode = 200;
      if (typeof res.send === 'function') {
        return res.send(buffer);
      }
      return res.end(buffer);
    }

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Access-Control-Allow-Origin': config.server.corsOrigin,
        ...IMAGE_CACHE,
      },
    });
  } catch (error: any) {
    return sendJson(res, 502, reportFailure('camera', error));
  }
});
export default handler;

export async function GET(request: Request) {
  return handler(request);
}
