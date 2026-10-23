import { readRequestAccountKey, requestSchemas } from '../http/requestSchemas.ts';
import { withRequestSchema } from '../http/validateRequest.ts';
import { config } from '../../config/server.ts';
import { InvalidPayloadError, reportFailure, UpstreamHttpError } from '../../shared/diagnostics.ts';
import { sendJson, setHeaders, liveCacheHeaders } from '../http/responses.ts';
import { providerRetryHeaders, readProvider } from '../http/readProvider.ts';
export interface LtaRequestOptions {
  endpoint: string;
  defaultSkip?: number;
}

export function getLtaAccountKey(req?: any): string | null {
  // Every handler uses the same validated key and legacy-alias precedence.
  const headerKey = req === undefined ? null : readRequestAccountKey(req);
  return config.server.accountKey ?? headerKey;
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
  return withRequestSchema(requestSchemas.lta, async (request, responseTarget, input) => {
    return runLtaRequest(endpointUrl, responseTarget, input.query, getLtaAccountKey() ?? input.accountKey, validate);
  })(req, res);
}

async function runLtaRequest(
  endpointUrl: string, res: any, query: { skip?: number }, accountKey: string | null,
  validate?: (value: unknown) => boolean,
): Promise<Response | void> {
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
    const urlObj = new URL(endpointUrl);
    if (query.skip !== undefined) urlObj.searchParams.set('$skip', String(query.skip));

    const { data, status } = await readProvider(urlObj.toString(), async (response) => {
      let data;
      try { data = await response.json(); }
      catch (error) {
        if (error instanceof SyntaxError) throw new InvalidPayloadError();
        throw error;
      }
      if (validate ? !validate(data) : !data || !Array.isArray(data.value)) throw new InvalidPayloadError();
      return { data, status: response.status };
    }, { method: 'GET', headers: { AccountKey: accountKey, accept: 'application/json' } });

    const cache = LTA_PROXY_CACHE;
    if (res && typeof res.status === 'function') {
      setHeaders(res, cache);
      return res.status(status).json(data);
    }

    return new Response(JSON.stringify(data), {
      status,
      headers: {
        'Content-Type': 'application/json',
        ...cache,
      },
    });
  } catch (error: any) {
    return sendJson(res, error instanceof UpstreamHttpError ? error.status : 502, reportFailure('lta', error), providerRetryHeaders(error));
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
    return readProvider(`${url}?$skip=${skip}`, async (response) => {
      const data = await response.json();
      if (!Array.isArray(data?.value)) throw new InvalidPayloadError();
      return data.value;
    }, { headers: { AccountKey: accountKey, accept: 'application/json' } });
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
