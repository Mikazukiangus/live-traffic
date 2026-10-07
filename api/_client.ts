/**
 * LTA DataMall Serverless Client Helper
 * Handles authentication, proxying, query params, and CORS for LTA DataMall OData APIs.
 */

export interface LtaRequestOptions {
  endpoint: string;
  defaultSkip?: number;
}

export function getLtaAccountKey(req?: any): string | null {
  // Check environment variables first
  if (process.env.LTA_ACCOUNT_KEY && process.env.LTA_ACCOUNT_KEY.trim() !== '') {
    return process.env.LTA_ACCOUNT_KEY.trim();
  }
  if (process.env.LTA_API_KEY && process.env.LTA_API_KEY.trim() !== '') {
    return process.env.LTA_API_KEY.trim();
  }

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
    res.setHeader('Access-Control-Allow-Origin', '*');
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
const LTA_PROXY_CACHE = liveCacheHeaders(30, 60);

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
        'Access-Control-Allow-Origin': '*',
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

    if (res && typeof res.status === 'function') {
      setCorsHeaders(res);
      return res.status(401).json(errorBody);
    }

    return new Response(JSON.stringify(errorBody), {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
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
      headers: {
        AccountKey: accountKey,
        accept: 'application/json',
      },
    });

    const contentType = response.headers.get('content-type') || '';
    let data: any;

    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }

    const cache = response.ok ? LTA_PROXY_CACHE : NO_STORE;
    if (res && typeof res.status === 'function') {
      setCorsHeaders(res);
      setHeaders(res, cache);
      return res.status(response.status).json(data);
    }

    return new Response(JSON.stringify(data), {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        ...cache,
      },
    });
  } catch (error: any) {
    const errorBody = {
      status: 'error',
      statusCode: 502,
      error: 'Failed to fetch from LTA DataMall',
      message: error?.message || 'Unknown network error',
      endpoint: endpointUrl,
    };

    if (res && typeof res.status === 'function') {
      setCorsHeaders(res);
      return res.status(502).json(errorBody);
    }

    return new Response(JSON.stringify(errorBody), {
      status: 502,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
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
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', ...cache },
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
export async function fetchLtaAll(url: string, accountKey: string, { wave = 6, maxPages = 40 } = {}): Promise<any[]> {
  const page = async (skip: number): Promise<any[]> => {
    for (let attempt = 1; ; attempt++) {
      const response = await fetch(`${url}?$skip=${skip}`, {
        headers: { AccountKey: accountKey, accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) return (await response.json()).value || [];
      // LTA throttles bursts; back off and try twice more.
      if (attempt >= 3) throw new Error(`LTA responded ${response.status} at $skip=${skip}`);
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  };
  const records: any[] = [];
  for (let start = 0; start < maxPages; start += wave) {
    const pages = await Promise.all(Array.from({ length: wave }, (_, i) => page((start + i) * LTA_PAGE_SIZE)));
    for (const p of pages) records.push(...p);
    if (pages.some((p) => p.length < LTA_PAGE_SIZE)) break;
  }
  return records;
}

/** Fetches a data.gov.sg v2 real-time feed (wrapped { code, errorMsg, data }), retrying once on 429. */
export async function fetchDataGovV2(url: string): Promise<any> {
  const get = () => fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
  let response = await get();
  // data.gov.sg rate-limits keyless calls in short bursts; one retry usually gets through.
  if (response.status === 429) {
    await new Promise((r) => setTimeout(r, 1500));
    response = await get();
  }
  if (!response.ok) throw new Error(`Upstream responded ${response.status}`);
  const json = await response.json();
  if (json?.code !== 0 || !json?.data) throw new Error(json?.errorMsg || 'Unexpected payload');
  return json.data;
}
