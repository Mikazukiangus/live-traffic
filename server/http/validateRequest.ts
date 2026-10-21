import { handlePreflight, NO_STORE, sendJson } from './responses.ts';
import { parseApiRequest, RequestValidationError, type QuerySchema } from './requestSchemas.ts';
import { corsHeaders, corsVary, setNodeCors, setWebCors } from './cors.ts';

/** The business handler runs only after the entire public request contract succeeds. */
export function withRequestSchema<T>(
  schema: QuerySchema<T>,
  handler: (req: any, res: any, input: { query: T; accountKey: string | null }) => any,
) {
  return async (req: any, res?: any) => {
    let input: ReturnType<typeof parseApiRequest<T>>;
    let headers: Record<string, string> = { Vary: corsVary(req) };
    try {
      headers = corsHeaders(req);
      input = parseApiRequest(req, schema);
    }
    catch (error) {
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
  };
}
