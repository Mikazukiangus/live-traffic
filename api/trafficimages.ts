import { config } from '../config/server.ts';
/**
 * LTA Traffic Images Serverless Endpoint
 * - If LTA_ACCOUNT_KEY is present: fetches full Singapore expressway cameras from LTA DataMall Traffic-Imagesv2
 * - If LTA_ACCOUNT_KEY is missing: seamlessly fetches official real-time traffic images from Data.gov.sg open transport API
 * Returns normalized live camera feed with real-time timestamps and direct image URLs.
 */
import { getLtaAccountKey, liveCacheHeaders, setHeaders } from './_client.ts';

// LTA captures every 1-5 minutes; the page polls every 30 seconds.
const CACHE = liveCacheHeaders(...config.server.cache.proxy);

const LTA_DATAMALL_TRAFFIC_IMAGES = config.server.upstreams.images;
const DATA_GOV_TRAFFIC_IMAGES = config.trafficImagesUrl;

// DataMall image names embed the capture time in UTC, e.g. .../2701_1120_20261005033013_E7E99C.jpg
function captureTimeFromLink(link: string): string | null {
  const match = /_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_[^/_]*\.jpg/i.exec(link || '');
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`).toISOString();
}

export default async function handler(req: any, res?: any) {
  const accountKey = getLtaAccountKey(req);

  // 1. If official DataMall AccountKey is configured, query DataMall v2
  if (accountKey) {
    try {
      const dmResponse = await fetch(LTA_DATAMALL_TRAFFIC_IMAGES, {
        signal: AbortSignal.timeout(config.server.requestTimeoutMs),
        headers: {
          AccountKey: accountKey,
          accept: 'application/json',
        },
      });

      if (dmResponse.ok) {
        const dmData = await dmResponse.json();
        const rawCameras = dmData.value || [];

        const fetchedAt = new Date().toISOString();
        const normalized = rawCameras.map((c: any) => ({
          camera_id: String(c.CameraID),
          image: c.ImageLink,
          latitude: c.Latitude,
          longitude: c.Longitude,
          timestamp: captureTimeFromLink(c.ImageLink) || fetchedAt,
        }));
        // Report the newest capture rather than the request time.
        const latestCapture = normalized.reduce(
          (latest: string, c: any) => (c.timestamp > latest ? c.timestamp : latest),
          normalized[0]?.timestamp || fetchedAt
        );

        const payload = {
          success: true,
          source: 'lta_datamall_v2',
          totalCameras: normalized.length,
          timestamp: latestCapture,
          cameras: normalized,
        };

        if (res && typeof res.status === 'function') {
          res.setHeader('Content-Type', 'application/json');
          setHeaders(res, CACHE);
          return res.status(200).json(payload);
        }
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            ...CACHE,
          },
        });
      }
    } catch {
      // Fall through to open Data.gov.sg
    }
  }

  // 2. Open LTA Data.gov.sg Real-Time Transport Camera Feed
  try {
    const govResponse = await fetch(DATA_GOV_TRAFFIC_IMAGES, {
      signal: AbortSignal.timeout(config.server.requestTimeoutMs),
      headers: {
        accept: 'application/json',
      },
    });

    if (govResponse.ok) {
      const govData = await govResponse.json();
      const item = govData?.items?.[0] || {};
      const rawCameras = item.cameras || [];
      const timestamp = item.timestamp || new Date().toISOString();

      const normalized = rawCameras.map((c: any) => ({
        camera_id: String(c.camera_id),
        image: c.image,
        latitude: c.location?.latitude,
        longitude: c.location?.longitude,
        timestamp: c.timestamp || timestamp,
      }));

      const payload = {
        success: true,
        source: 'data_gov_sg_lta_live',
        totalCameras: normalized.length,
        timestamp,
        cameras: normalized,
      };

      if (res && typeof res.status === 'function') {
        res.setHeader('Content-Type', 'application/json');
        setHeaders(res, CACHE);
        return res.status(200).json(payload);
      }
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...CACHE,
        },
      });
    }

    throw new Error(`Upstream returned ${govResponse.status}`);
  } catch (error: any) {
    const errPayload = {
      success: false,
      error: 'Failed to fetch live traffic images',
      message: error?.message,
    };
    if (res && typeof res.status === 'function') {
      return res.status(502).json(errPayload);
    }
    return new Response(JSON.stringify(errPayload), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export async function GET(request: Request) {
  return handler(request);
}
