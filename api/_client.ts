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
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
  }
}

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

    if (res && typeof res.status === 'function') {
      setCorsHeaders(res);
      return res.status(response.status).json(data);
    }

    return new Response(JSON.stringify(data), {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
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
