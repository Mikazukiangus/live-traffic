import { AsyncLocalStorage } from 'node:async_hooks';
import { config } from '../../config/server.ts';
import { installErrorTracking, newErrorId, safeRoute, type ErrorContext } from '../../shared/errorTracking.ts';

const requests = new AsyncLocalStorage<{ request: object; context: ErrorContext }>();
installErrorTracking({ context: () => ({ ...config.errorTracking, ...requests.getStore()?.context }) });

export function currentErrorContext(): ErrorContext {
  return { ...config.errorTracking, ...requests.getStore()?.context };
}

/** Route labels come from a closed vocabulary. Never trust incoming request/correlation IDs. */
export function withErrorContext<T>(req: any, run: () => T): T {
  if (requests.getStore()?.request === req) return run();
  let route = 'unknown';
  try {
    const url = new URL(req.url, config.siteUrl);
    route = url.pathname.startsWith('/api/auth/') ? 'auth' : safeRoute(url.pathname.replace(/^\/api\/_?/, ''));
    if (route === 'live') {
      const feed = url.searchParams.get('feed') ?? req.query?.feed;
      if (['carparks', 'roadconditions', 'weatheralerts', 'floods', 'forecast24h', 'errors'].includes(feed)) route = feed;
    }
  } catch { /* Only a fixed unknown route is retained for malformed requests. */ }
  const context = { requestId: newErrorId(), route, method: req?.method };
  return requests.run({ request: req, context }, run);
}
