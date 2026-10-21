import { config } from '../../config/server.ts';
import { RequestValidationError } from './requestSchemas.ts';
import { localCorsOrigins } from './localCors.ts';

const METHODS = 'GET, OPTIONS';
const ALLOWED_HEADERS = ['Content-Type', 'AccountKey', 'x-account-key', 'x-lta-account-key'];

/** Reject ambiguous Node headers and comma-joined Web duplicates without echoing values. */
function header(req: any, name: string): string | undefined {
  let values: unknown[] = [];
  if (req?.headers instanceof Headers) {
    const value = req.headers.get(name);
    if (value !== null) values = [value];
  } else if (req?.headers && typeof req.headers === 'object' && !Array.isArray(req.headers)) {
    values = Object.entries(req.headers).filter(([key]) => key.toLowerCase() === name).map(([, value]) => value);
  } else if (req?.headers !== undefined) {
    throw new RequestValidationError('headers');
  }
  if (Array.isArray(req?.rawHeaders)) {
    const raw: unknown[] = [];
    for (let i = 0; i < req.rawHeaders.length; i += 2)
      if (typeof req.rawHeaders[i] === 'string' && req.rawHeaders[i].toLowerCase() === name) raw.push(req.rawHeaders[i + 1]);
    if (raw.length > 1 || (raw.length === 1 && (values.length !== 1 || raw[0] !== values[0])))
      throw new RequestValidationError('headers');
  }
  if (values.length > 1 || values.some((value) => typeof value !== 'string' || !value || value.length > 2048 || /[^\x20-\x7e]/.test(value)))
    throw new RequestValidationError('headers');
  return values[0] as string | undefined;
}

/** Always vary, including absent/disallowed origins: otherwise shared caches mix policies. */
export function corsVary(req: any): string {
  return req?.method === 'OPTIONS' ? 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers' : 'Origin';
}

export function corsHeaders(req: any, allowedOrigins: readonly string[] = config.server.corsOrigins): Record<string, string> {
  const origin = header(req, 'origin');
  const method = header(req, 'access-control-request-method');
  const requestedHeaders = header(req, 'access-control-request-headers');
  const result: Record<string, string> = { Vary: corsVary(req) };
  if (origin !== undefined) {
    // Exact serialized-origin equality also rejects null, lists, paths and suffix tricks.
    if (!allowedOrigins.includes(origin) && !localCorsOrigins(req).includes(origin))
      throw new RequestValidationError('headers', 403, 'CORS_ORIGIN_DENIED');
    result['Access-Control-Allow-Origin'] = origin;
  }
  if (req?.method !== 'OPTIONS') {
    if (method !== undefined || requestedHeaders !== undefined) throw new RequestValidationError('headers');
    return result;
  }
  if (origin !== undefined || method !== undefined || requestedHeaders !== undefined) {
    if (!origin || !method) throw new RequestValidationError('headers');
    if (method !== 'GET') throw new RequestValidationError('headers', 403, 'CORS_METHOD_DENIED');
    const tokens = requestedHeaders?.split(',').map((token) => token.trim().toLowerCase()) ?? [];
    if (tokens.some((token) => !/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(token))) throw new RequestValidationError('headers');
    if (tokens.some((token) => !ALLOWED_HEADERS.some((allowed) => allowed.toLowerCase() === token)))
      throw new RequestValidationError('headers', 403, 'CORS_HEADERS_DENIED');
  }
  result['Access-Control-Allow-Methods'] = METHODS;
  result['Access-Control-Allow-Headers'] = ALLOWED_HEADERS.join(', ');
  return result;
}

function mergeVary(existing: string | undefined, next: string): string {
  const tokens = [...(existing?.split(',') ?? []), ...next.split(',')].map((token) => token.trim()).filter(Boolean);
  return tokens.includes('*') ? '*' : [...new Map(tokens.map((token) => [token.toLowerCase(), token])).values()].join(', ');
}

/** Node headers must be set before send; Web responses are decorated after resolution. */
export function setNodeCors(res: any, headers: Record<string, string>) {
  if (!res || typeof res.setHeader !== 'function') return;
  for (const [name, value] of Object.entries(headers))
    res.setHeader(name, name === 'Vary' ? mergeVary(res.getHeader?.('Vary')?.toString(), value) : value);
}

export function setWebCors(result: any, headers: Record<string, string>) {
  if (!(result instanceof Response)) return result;
  // Reconstruct so even immutable upstream Response headers can be decorated safely.
  const merged = new Headers(result.headers);
  for (const [name, value] of Object.entries(headers)) merged.set(name, name === 'Vary' ? mergeVary(merged.get(name) ?? undefined, value) : value);
  return new Response(result.body, { status: result.status, statusText: result.statusText, headers: merged });
}
