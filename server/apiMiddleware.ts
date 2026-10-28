import { reportFailure } from '../shared/diagnostics.ts';
import { markLocalCorsRequest } from './http/localCors.ts';

type Loader = () => Promise<{ default: (req: any, res?: any) => any }>;

/** Shared by dev and preview; loaders run only after Vite initializes validated config. */
export function createApiMiddleware(handlers: Record<string, Loader>) {
  return async function apiMiddleware(req: any, res: any, next: () => void) {
    if (!req.url?.startsWith('/api/')) return next();
    // Preserve anonymous camera pixel access in local production-preview and CLI port overrides.
    // The bound loopback socket supplies this origin; Host/Forwarded headers are never trusted.
    markLocalCorsRequest(req);
    const pathname = req.url.split('?')[0].replace(/\.ts$/, '');
    if (typeof res.json !== 'function') {
      res.json = (body: unknown) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(body));
        return res;
      };
    }
    if (typeof res.status !== 'function') {
      res.status = (code: number) => { res.statusCode = code; return res; };
    }
    const dispatch = async () => {
      try {
        const load = pathname.startsWith('/api/auth/') ? handlers['/api/live'] : handlers[pathname];
        if (!load) return next();
        const { default: handler } = await load();
        await handler(req, res);
      } catch (error) {
        const body = reportFailure('gateway', error);
        res.statusCode = 500;
        res.setHeader('Cache-Control', 'no-store');
        res.json({ ...body, error: 'Internal Server Error' });
      }
    };
    // Vite imports this adapter before loading its environment. Install server context only per invocation.
    const { withErrorContext } = await import('./observability/context.ts');
    return withErrorContext(req, dispatch);
  };
}
