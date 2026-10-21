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

/** JSON response for both Node-style (req, res) and Web Request -> Response handlers. */
export function sendJson(res: any, status: number, body: unknown, cache: Record<string, string> = NO_STORE) {
  if (res && typeof res.status === 'function') {
    res.setHeader('Content-Type', 'application/json');
    setHeaders(res, cache);
    return res.status(status).json(body);
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cache },
  });
}

/** Answers a CORS preflight; returns undefined for any other request. */
export function handlePreflight(req: any, res?: any) {
  if (!req || req.method !== 'OPTIONS') return undefined;
  if (res && typeof res.status === 'function') {
    setHeaders(res, NO_STORE);
    return res.status(204).end();
  }
  return new Response(null, { status: 204, headers: {
    ...NO_STORE,
  } });
}
