import { config } from '../config/server.ts';
import { reportFailure, UpstreamHttpError } from '../shared/diagnostics.ts';
/**
 * LTA DataMall Serverless Client Helper
 * Handles authentication, proxying, query params, and CORS for LTA DataMall OData APIs.
 */

export interface LtaRequestOptions {
  endpoint: string;
  defaultSkip?: number;
}

export function getLtaAccountKey(req?: any): string | null {
  // Every handler uses the same validated key and legacy-alias precedence.
  if (config.server.accountKey) return config.server.accountKey;

  // Check incoming request headers if passed by client
  if (req && req.headers) {
    const headerKey =
      req.headers['accountkey'] ||
      req.headers['AccountKey'] ||
      req.headers['x-account-key'] ||
      req.headers['x-lta-account-key'];
    if (headerKey && typeof headerKey === 'string' && headerKey.trim() !== '') {
      return headerKey.trim();
    }
  }

  return null;
}

export function setCorsHeaders(res: any) {
  if (res && typeof res.setHeader === 'function') {
    res.setHeader('Access-Control-Allow-Origin', config.server.corsOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, AccountKey, Authorization, x-account-key');
  }
}

/**
 * Cache headers for live data. Only Vercel's CDN may cache (and serve stale while it refreshes);
 * Vercel-CDN-Cache-Control is not passed on, so browsers see max-age=0 and always revalidate.
 * A plain `s-maxage, stale-while-revalidate` Cache-Control would also let browsers show
 * minutes-old data on first load.
 */
export function liveCacheHeaders(cdnSeconds: number, staleSeconds: number): Record<string, string> {
  return {
    'Cache-Control': 'public, max-age=0, must-revalidate',
    'Vercel-CDN-Cache-Control': `max-age=${cdnSeconds}, stale-while-revalidate=${staleSeconds}`,
  };
}

export const NO_STORE: Record<string, string> = { 'Cache-Control': 'no-store' };

export function setHeaders(res: any, headers: Record<string, string>) {
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
}

// LTA DataMall incidents, VMS and travel times refresh every 1-5 minutes.
const LTA_PROXY_CACHE = liveCacheHeaders(...config.server.cache.proxy);

/**
 * Universal Serverless Handler for LTA DataMall endpoints.
 * Supports both Node/Express style (req, res) and Web standard Request -> Response.
 */
export async function handleLtaRequest(
  endpointUrl: string,
  req: any,
  res?: any
): Promise<Response | void> {
  // Handle CORS preflight
  if (req && req.method === 'OPTIONS') {
    if (res && typeof res.status === 'function') {
      setCorsHeaders(res);
      return res.status(204).end();
    }
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': config.server.corsOrigin,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, AccountKey, Authorization, x-account-key',
      },
    });
  }

  const accountKey = getLtaAccountKey(req);

  // If AccountKey is missing, return informative 401 response
  if (!accountKey) {
    const errorBody = {
      status: 'error',
      statusCode: 401,
      error: 'Missing LTA DataMall AccountKey',
      message:
        'Please configure LTA_ACCOUNT_KEY in your environment variables or provide the AccountKey request header.',
      documentation: 'https://datamall.lta.gov.sg/content/datamall/en.html',
    };

    return sendJson(res, 401, errorBody);
  }

  try {
    // Extract query parameters ($skip, etc.)
    const urlObj = new URL(endpointUrl);

    if (req) {
      if (req.query) {
        Object.entries(req.query).forEach(([key, val]) => {
          if (typeof val === 'string') {
            urlObj.searchParams.set(key, val);
          }
        });
      } else if (req.url && req.url.includes('?')) {
        const queryPart = req.url.split('?')[1];
        const searchParams = new URLSearchParams(queryPart);
        searchParams.forEach((val, key) => {
          urlObj.searchParams.set(key, val);
        });
      }
    }

    const response = await fetch(urlObj.toString(), {
      method: 'GET',
      signal: AbortSignal.timeout(config.server.requestTimeoutMs),
      headers: {
        AccountKey: accountKey,
        accept: 'application/json',
      },
    });

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return sendJson(res, response.status, reportFailure('lta', undefined, response.status));
    }

    const data = await response.json();
    if (!data || !Array.isArray(data.value)) throw new Error('Unexpected LTA payload');

    const cache = LTA_PROXY_CACHE;
    if (res && typeof res.status === 'function') {
      setCorsHeaders(res);
      setHeaders(res, cache);
      return res.status(response.status).json(data);
    }

    return new Response(JSON.stringify(data), {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': config.server.corsOrigin,
        ...cache,
      },
    });
  } catch (error: any) {
    return sendJson(res, 502, reportFailure('lta', error));
  }
}

/** JSON response for both Node-style (req, res) and Web Request -> Response handlers. */
export function sendJson(res: any, status: number, body: unknown, cache: Record<string, string> = NO_STORE) {
  if (res && typeof res.status === 'function') {
    setCorsHeaders(res);
    res.setHeader('Content-Type', 'application/json');
    setHeaders(res, cache);
    return res.status(status).json(body);
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': config.server.corsOrigin, ...cache },
  });
}

/** Answers a CORS preflight; returns undefined for any other request. */
export function handlePreflight(req: any, res?: any) {
  if (!req || req.method !== 'OPTIONS') return undefined;
  if (res && typeof res.status === 'function') {
    setCorsHeaders(res);
    return res.status(204).end();
  }
  return new Response(null, { status: 204 });
}

const LTA_PAGE_SIZE = 500;

/**
 * Every record of a paged LTA DataMall dataset (500 per page). LTA doesn't say how many pages
 * there are, so pages are fetched in parallel waves until a short page comes back.
 */
export async function fetchLtaAll(url: string, accountKey: string, { wave = config.server.lta.concurrency, maxPages = config.server.lta.maxPages } = {}): Promise<any[]> {
  const page = async (skip: number): Promise<any[]> => {
    for (let attempt = 1; ; attempt++) {
      const response = await fetch(`${url}?$skip=${skip}`, {
        headers: { AccountKey: accountKey, accept: 'application/json' },
        signal: AbortSignal.timeout(config.server.requestTimeoutMs),
      });
      if (response.ok) {
        const data = await response.json();
        if (!Array.isArray(data?.value)) throw new Error('Unexpected LTA payload');
        return data.value;
      }
      // LTA throttles bursts; back off and try twice more.
      await response.body?.cancel().catch(() => undefined);
      if (attempt >= config.server.lta.attempts) throw new UpstreamHttpError(response.status);
      await new Promise((r) => setTimeout(r, config.server.lta.retryDelayMs * attempt));
    }
  };
  const records: any[] = [];
  for (let start = 0; start < maxPages; start += wave) {
    const pages = await Promise.all(Array.from({ length: Math.min(wave, maxPages - start) }, (_, i) => page((start + i) * LTA_PAGE_SIZE)));
    for (const p of pages) records.push(...p);
    if (pages.some((p) => p.length < LTA_PAGE_SIZE)) return records;
  }
  throw new Error('LTA dataset exceeds configured LTA_MAX_PAGES; refusing a partial result');
}

/** Fetches a data.gov.sg v2 real-time feed (wrapped { code, errorMsg, data }), retrying once on 429. */
export async function fetchDataGovV2(url: string): Promise<any> {
  const get = () => fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(config.server.weatherTimeoutMs) });
  let response = await get();
  // data.gov.sg rate-limits keyless calls in short bursts; one retry usually gets through.
  if (response.status === 429) {
    await new Promise((r) => setTimeout(r, config.server.weatherRetryDelayMs));
    response = await get();
  }
  if (!response.ok) throw new UpstreamHttpError(response.status);
  const json = await response.json();
  if (json?.code !== 0 || !json?.data) throw new Error('Unexpected provider payload');
  return json.data;
}
