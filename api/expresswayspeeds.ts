import { reportFailure } from '../shared/diagnostics.ts';
import { config } from '../config/server.ts';
import { getSpeedSummary } from '../server/traffic/speedService.ts';
import { NO_STORE, getLtaAccountKey, liveCacheHeaders, setCorsHeaders, setHeaders } from './_client.ts';
export type { ExpresswaySpeedSummary, CheckpointApproach, SpeedSegment } from '../shared/traffic/types.ts';
export { traceCheckpoint, CHECKPOINT_ROUTES } from '../server/traffic/traceCheckpoint.ts';

function wantsSegments(req: any): boolean {
  if (req?.query?.include) return String(req.query.include).split(',').includes('segments');
  const query = typeof req?.url === 'string' && req.url.includes('?') ? req.url.split('?')[1] : '';
  return (new URLSearchParams(query).get('include') || '').split(',').includes('segments');
}

export default async function handler(req: any, res?: any) {
  if (req && req.method === 'OPTIONS') {
    if (res && typeof res.status === 'function') {
      setCorsHeaders(res);
      return res.status(204).end();
    }
    return new Response(null, { status: 204 });
  }

  const send = (status: number, body: any, cache: Record<string, string>) => {
    if (res && typeof res.status === 'function') {
      setCorsHeaders(res);
      res.setHeader('Content-Type', 'application/json');
      setHeaders(res, cache);
      return res.status(status).json(body);
    }
    return new Response(JSON.stringify(body), {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': config.server.corsOrigin,
        ...cache,
      },
    });
  };

  const accountKey = getLtaAccountKey();
  if (!accountKey) {
    return send(401, { success: false, error: 'LTA_ACCOUNT_KEY not configured' }, NO_STORE);
  }

  try {
    const cache = await getSpeedSummary(accountKey);
    const body = wantsSegments(req) ? { ...cache.payload, segments: cache.segments } : cache.payload;
    return send(200, body, liveCacheHeaders(...config.server.cache.speeds));
  } catch (err: any) {
    return send(502, reportFailure('lta', err), NO_STORE);
  }
}

export async function GET(request: Request) {
  return handler(request);
}
