/**
 * Serverless Image Proxy for Singapore LTA and Open Data Traffic Images.
 * Fixes browser MIME-type blocking (x-content-type-options: nosniff on application/octet-stream)
 * by proxying the image and serving with correct image/jpeg headers and caching.
 */
import { setHeaders } from './_client.ts';

// LTA DataMall camera images are S3 links without CORS headers; proxying them lets the
// browser read pixels for vehicle counting.
// Each LTA image link is unique per capture (and expires after 15 minutes), so the photo
// behind a URL never changes: browsers and Vercel's CDN can both keep it for that long.
const IMAGE_CACHE = {
  'Cache-Control': 'public, max-age=900',
  'Vercel-CDN-Cache-Control': 'max-age=900',
};

const ALLOWED_HOSTS = [
  'images.data.gov.sg',
  'datamall2.mytransport.sg',
  'datamall.lta.gov.sg',
  'dm-traffic-camera-itsc.s3.ap-southeast-1.amazonaws.com',
];

export default async function handler(req: any, res?: any) {
  if (req && req.method === 'OPTIONS') {
    if (res && typeof res.status === 'function') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      return res.status(204).end();
    }
    return new Response(null, { status: 204 });
  }

  let imageUrl: string | null = null;

  if (req.query && req.query.url) {
    imageUrl = req.query.url;
  } else if (req.url && req.url.includes('?')) {
    const searchParams = new URLSearchParams(req.url.split('?')[1]);
    imageUrl = searchParams.get('url');
  }

  if (!imageUrl) {
    const err = { error: 'Missing image url parameter' };
    if (res && typeof res.status === 'function') {
      return res.status(400).json(err);
    }
    return new Response(JSON.stringify(err), { status: 400 });
  }

  try {
    const parsed = new URL(imageUrl);
    if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.includes(parsed.hostname)) {
      const err = { error: 'Host not permitted in proxy' };
      if (res && typeof res.status === 'function') {
        return res.status(403).json(err);
      }
      return new Response(JSON.stringify(err), { status: 403 });
    }

    const response = await fetch(imageUrl, {
      headers: {
        accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
    });

    if (!response.ok) {
      throw new Error(`Upstream returned ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (res && typeof res.status === 'function') {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Access-Control-Allow-Origin', '*');
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
        'Access-Control-Allow-Origin': '*',
        ...IMAGE_CACHE,
      },
    });
  } catch (error: any) {
    const err = { error: 'Failed to proxy image', message: error?.message };
    if (res && typeof res.status === 'function') {
      return res.status(502).json(err);
    }
    return new Response(JSON.stringify(err), { status: 502 });
  }
}

export async function GET(request: Request) {
  return handler(request);
}
