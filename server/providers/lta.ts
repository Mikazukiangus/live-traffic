import { config } from '../../config/server.ts';
import { InvalidPayloadError, reportFailure, UpstreamHttpError } from '../../shared/diagnostics.ts';
import { sendJson, setCorsHeaders, setHeaders, liveCacheHeaders } from '../http/responses.ts';
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

// LTA DataMall incidents, VMS and travel times refresh every 1-5 minutes.
const LTA_PROXY_CACHE = liveCacheHeaders(...config.server.cache.proxy);

/**
 * Universal Serverless Handler for LTA DataMall endpoints.
 * Supports both Node/Express style (req, res) and Web standard Request -> Response.
 */
export async function handleLtaRequest(
  endpointUrl: string,
  req: any,
  res?: any,
  validate?: (value: unknown) => boolean,
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

    let data;
    try {
      data = await response.json();
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) throw error;
      throw new InvalidPayloadError();
    }
    if (validate ? !validate(data) : !data || !Array.isArray(data.value)) throw new InvalidPayloadError();

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

const LTA_PAGE_SIZE = 500;

/**
 * Every record of a paged LTA DataMall dataset (500 per page). LTA doesn't say how many pages
 * there are, so pages are fetched in parallel waves until a short page comes back.
 */
export async function fetchLtaAll(
  url: string,
  accountKey: string,
  { wave = config.server.lta.concurrency, maxPages = config.server.lta.maxPages } = {},
): Promise<any[]> {
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
    const pages = await Promise.all(
      Array.from({ length: Math.min(wave, maxPages - start) }, (_, i) => page((start + i) * LTA_PAGE_SIZE)),
    );
    for (const p of pages) records.push(...p);
    if (pages.some((p) => p.length < LTA_PAGE_SIZE)) return records;
  }
  throw new Error('LTA dataset exceeds configured LTA_MAX_PAGES; refusing a partial result');
}
