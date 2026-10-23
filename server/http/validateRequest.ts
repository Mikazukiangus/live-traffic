import { handlePreflight, NO_STORE, sendJson } from './responses.ts';
import { parseApiRequest, RequestValidationError, type QuerySchema } from './requestSchemas.ts';
import { corsHeaders, corsVary, setNodeCors, setWebCors } from './cors.ts';
import { InvalidPayloadError, reportFailure, UpstreamHttpError } from '../../shared/diagnostics.ts';
import { reportApplicationFailure } from '../../shared/applicationDiagnostics.ts';
import { providerFailureHeaders } from './providerFailure.ts';

/** The business handler runs only after the entire public request contract succeeds. */
export function withRequestSchema<T>(
  schema: QuerySchema<T>,
  handler: (req: any, res: any, input: { query: T; accountKey: string | null }) => any,
) {
  return async (req: any, res?: any) => {
    let headers: Record<string, string> = { Vary: 'Origin' };
    try {
      headers = { Vary: corsVary(req) };
      let input: ReturnType<typeof parseApiRequest<T>>;
      try {
        headers = corsHeaders(req);
        input = parseApiRequest(req, schema);
      } catch (error) {
        if (!(error instanceof RequestValidationError)) throw error;
        setNodeCors(res, headers);
        return setWebCors(sendJson(res, error.status, {
          success: false, code: error.code, error: error.status === 405 ? 'Method not allowed' : error.code.startsWith('CORS_') ? 'Cross-origin request denied' : 'Invalid request',
          issues: [{ field: error.field, code: error.code }],
        }, { ...NO_STORE, ...(error.status === 405 ? { Allow: 'GET, OPTIONS' } : {}) }), headers);
      }
      setNodeCors(res, headers);
      if (input.preflight) return setWebCors(handlePreflight(req, res), headers);
      return setWebCors(await handler(req, res, { query: input.query, accountKey: input.accountKey }), headers);
    } catch (error) {
      const provider = error instanceof InvalidPayloadError || error instanceof UpstreamHttpError;
      const body = provider ? reportFailure('gateway', error) : reportApplicationFailure('api');
      // Never attempt a second response or disclose the original exception on the socket.
      if (res?.headersSent || res?.writableEnded) {
        if (!res.writableEnded && !res.destroyed) res.destroy?.();
        return;
      }
      // A failed handler may have prepared cache/binary headers before throwing.
      for (const name of ['Content-Length', 'Content-Encoding', 'ETag', 'Last-Modified', 'Retry-After']) res?.removeHeader?.(name);
      const cache = { ...providerFailureHeaders(error), 'CDN-Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store' };
      setNodeCors(res, headers);
      const status = provider ? error instanceof UpstreamHttpError && error.status >= 400 ? error.status : 502 : 500;
      return setWebCors(sendJson(res, status, body, cache), headers);
    }
  };
}
