import { handlePreflight, NO_STORE, sendJson } from './responses.ts';
import { parseApiRequest, RequestValidationError, type QuerySchema } from './requestSchemas.ts';

/** The business handler runs only after the entire public request contract succeeds. */
export function withRequestSchema<T>(
  schema: QuerySchema<T>,
  handler: (req: any, res: any, input: { query: T; accountKey: string | null }) => any,
) {
  return async (req: any, res?: any) => {
    let input: ReturnType<typeof parseApiRequest<T>>;
    try { input = parseApiRequest(req, schema); }
    catch (error) {
      if (!(error instanceof RequestValidationError)) throw error;
      return sendJson(res, error.status, {
        success: false, code: error.code, error: error.status === 405 ? 'Method not allowed' : 'Invalid request',
        issues: [{ field: error.field, code: error.code }],
      }, { ...NO_STORE, ...(error.status === 405 ? { Allow: 'GET, OPTIONS' } : {}) });
    }
    if (input.preflight) return handlePreflight(req, res);
    return handler(req, res, { query: input.query, accountKey: input.accountKey });
  };
}
