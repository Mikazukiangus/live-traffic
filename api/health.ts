/**
 * Health check endpoint for TrafficPulse LTA DataMall serverless connection.
 */
import { getLtaAccountKey, setCorsHeaders } from './_client.ts';

export default async function handler(req: any, res?: any) {
  if (req && req.method === 'OPTIONS') {
    if (res && typeof res.status === 'function') {
      setCorsHeaders(res);
      return res.status(204).end();
    }
    return new Response(null, { status: 204 });
  }

  const accountKey = getLtaAccountKey(req);
  const healthData = {
    status: 'ok',
    service: 'TrafficPulse LTA DataMall Gateway',
    timestamp: new Date().toISOString(),
    ltaKeyConfigured: !!accountKey,
    keyMasked: accountKey ? `${accountKey.slice(0, 4)}...${accountKey.slice(-4)}` : null,
    endpoints: {
      health: '/api/health',
      trafficIncidents: '/api/traffic',
      trafficImages: '/api/trafficimages',
      trafficFlow: '/api/trafficflow',
      vmsEmas: '/api/vms',
      travelTimes: '/api/traveltimes',
    },
  };

  if (res && typeof res.status === 'function') {
    setCorsHeaders(res);
    return res.status(200).json(healthData);
  }

  return new Response(JSON.stringify(healthData), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export async function GET(request: Request) {
  return handler(request);
}
