import { IMAGE_PROXY_HOSTS, LIST_PAGINATION, LIVE_COLLECTIONS } from '../../config/policy.ts';

/** Public request contracts. Errors contain fixed metadata only, never submitted values. */
export class RequestValidationError extends Error {
  constructor(
    readonly field: 'request' | 'method' | 'query' | 'body' | 'headers' | 'url' | '$skip' | 'include' | 'feed' | 'limit' | 'offset' | 'collection' | 'snapshot',
    readonly status = 400,
    readonly code = 'INVALID_REQUEST',
  ) {
    super('Invalid request');
  }
}
function invalid(field: RequestValidationError['field']): never { throw new RequestValidationError(field); }
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
export type QuerySchema<T> = (query: ReadonlyMap<string, string>) => T;

function only(query: ReadonlyMap<string, string>, allowed: string[]) {
  if ([...query.keys()].some((key) => !allowed.includes(key))) invalid('query');
}
const FEEDS = ['roadconditions', 'carparks', 'weatheralerts', 'floods', 'forecast24h'] as const;
export type FeedName = typeof FEEDS[number];
const feedName = (value: string | undefined): FeedName => {
  if (!FEEDS.includes(value as FeedName)) invalid('feed');
  return value as FeedName;
};

export const PAGINATION_KEYS = ['limit', 'offset', 'collection', 'snapshot'] as const;
export interface ListPage { limit: number; offset: number; collection: string; snapshot?: string }
const pageInteger = (query: ReadonlyMap<string, string>, key: 'limit' | 'offset', fallback: number, min: number, max: number) => {
  const raw = query.get(key);
  if (raw === undefined) return fallback;
  if (!/^(0|[1-9]\d*)$/.test(raw) || raw.length > 10 || Number(raw) < min || Number(raw) > max) invalid(key);
  return Number(raw);
};
/** The rest of the route query is independently checked by its existing schema. */
export function listPage(query: ReadonlyMap<string, string>, collections: readonly string[]): ListPage | null {
  if (!PAGINATION_KEYS.some(key => query.has(key))) return null;
  const limit = pageInteger(query, 'limit', LIST_PAGINATION.defaultLimit, 1, LIST_PAGINATION.maxLimit);
  const offset = pageInteger(query, 'offset', 0, 0, LIST_PAGINATION.maxOffset);
  const collection = query.get('collection') ?? (collections.length === 1 ? collections[0] : undefined);
  if (!collection || !collections.includes(collection)) invalid('collection');
  const snapshot = query.get('snapshot');
  if ((snapshot !== undefined && !/^[a-f0-9]{64}$/.test(snapshot)) || (offset > 0 && snapshot === undefined)) invalid('snapshot');
  return { limit, offset, collection, ...(snapshot === undefined ? {} : { snapshot }) };
}
export function listQuery<T>(schema: QuerySchema<T>, collections: readonly string[], available?: (query: T) => readonly string[]) {
  return (query: ReadonlyMap<string, string>) => {
    const base = new Map([...query].filter(([key]) => !(PAGINATION_KEYS as readonly string[]).includes(key)));
    const parsed = schema(base);
    return { base: parsed, page: listPage(query, available?.(parsed) ?? collections) };
  };
}

export const requestSchemas = {
  empty: ((query) => { only(query, []); return {}; }) satisfies QuerySchema<Record<string, never>>,
  lta: ((query) => {
    only(query, ['$skip', 'limit', 'offset']);
    const skip = query.get('$skip');
    // OData Int32, no coercion of signs, exponents, whitespace, fractions or empty values.
    if (skip !== undefined && (!/^(0|[1-9]\d{0,9})$/.test(skip) || Number(skip) > 2_147_483_647)) invalid('$skip');
    if (query.has('$skip') && query.has('offset')) invalid('offset');
    const paged = query.has('limit') || query.has('offset');
    const offset = pageInteger(query, 'offset', skip === undefined ? 0 : Number(skip), 0, LIST_PAGINATION.maxOffset);
    if (paged && offset > LIST_PAGINATION.maxOffset) invalid('offset');
    const limit = pageInteger(query, 'limit', LIST_PAGINATION.defaultLimit, 1, LIST_PAGINATION.maxLimit);
    return { skip: paged ? offset : skip === undefined ? undefined : Number(skip), ...(paged ? { page: { offset, limit } } : {}) };
  }) satisfies QuerySchema<{ skip?: number; page?: { offset: number; limit: number } }>,
  speeds: ((query) => {
    only(query, ['include']);
    const include = query.get('include');
    if (include !== undefined && include !== 'segments') invalid('include');
    return { includeSegments: include === 'segments' };
  }) satisfies QuerySchema<{ includeSegments: boolean }>,
  live: ((query) => {
    only(query, ['feed', ...PAGINATION_KEYS]);
    const feed = feedName(query.get('feed'));
    listPage(query, LIVE_COLLECTIONS[feed]);
    return { feed };
  }) satisfies QuerySchema<{ feed: FeedName }>,
  image: ((query) => {
    only(query, ['url']);
    const imageUrl = query.get('url');
    if (!imageUrl || imageUrl.length > 8192 || /[\s\x00-\x1f\x7f\\]/.test(imageUrl) || /%(?![a-f\d]{2})/i.test(imageUrl)) invalid('url');
    let parsed: URL;
    try { parsed = new URL(imageUrl); } catch { return invalid('url'); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash ||
      (parsed.port && parsed.port !== '443') || !IMAGE_PROXY_HOSTS.includes(parsed.hostname)) {
      throw new RequestValidationError('url', 403, 'IMAGE_HOST_NOT_ALLOWED');
    }
    // Keep the original signed query bytes. URL is used only for validation.
    return { imageUrl };
  }) satisfies QuerySchema<{ imageUrl: string }>,
};

/** Internal feed modules may also be invoked directly; a supplied selector must match. */
export const internalFeedSchema = (name: FeedName): QuerySchema<Record<string, never>> => (query) => {
  only(query, ['feed']);
  if (query.has('feed') && query.get('feed') !== name) invalid('feed');
  return {};
};

export function headerValues(req: Record<string, unknown>, name: string): string[] {
  if (req.headers instanceof Headers) {
    const value = req.headers.get(name);
    return value === null ? [] : [value];
  }
  if (req.headers === undefined) return [];
  if (!record(req.headers)) return invalid('headers');
  return Object.entries(req.headers).filter(([key]) => key.toLowerCase() === name).map(([, value]) => {
    if (typeof value !== 'string') return invalid('headers');
    return value;
  });
}

/** Same validation for Node dictionaries and Web Headers, even if an env key takes precedence. */
export function readRequestAccountKey(req: unknown): string | null {
  if (!record(req)) return invalid('request');
  const names = ['accountkey', 'x-account-key', 'x-lta-account-key'];
  const values = names.flatMap((name) => headerValues(req, name));
  if (Array.isArray(req.rawHeaders)) {
    const counts = new Map<string, number>();
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = String(req.rawHeaders[i]).toLowerCase();
      if (names.includes(name)) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    if ([...counts.values()].some((n) => n > 1)) invalid('headers');
  }
  if (values.some((v) => !/^[\x21-\x7e]{1,512}$/.test(v) || v.includes(',')) || new Set(values).size > 1) invalid('headers');
  return values[0] ?? null;
}

export function queryValues(req: Record<string, unknown>): Map<string, string> {
  const raw = req.url;
  if (typeof raw !== 'string' || raw.length > 16384 || /[\x00-\x20\x7f\\#]/.test(raw) || /%(?![a-f\d]{2})/i.test(raw)) invalid('url');
  let url: URL;
  try {
    if (!(raw.startsWith('/') && !raw.startsWith('//')) && !/^https?:\/\//.test(raw)) return invalid('url');
    url = new URL(raw, 'https://request.invalid');
    if (url.username || url.password) return invalid('url');
    // URLSearchParams silently repairs invalid UTF-8; reject it instead.
    decodeURIComponent(url.search.replaceAll('+', ' '));
  } catch { return invalid('url'); }
  const values = new Map<string, string>();
  for (const [key, value] of url.searchParams) {
    if (values.has(key) || values.size >= 8) invalid('query');
    values.set(key, value);
  }
  if (req.query !== undefined) {
    if (!record(req.query) || Object.keys(req.query).length > 8) invalid('query');
    const entries = Object.entries(req.query);
    if (entries.some(([key, value]) => typeof value !== 'string' || key.length > 64 || value.length > 8192)) invalid('query');
    const nodeValues = new Map(entries as [string, string][]);
    // A framework's parsed query cannot hide duplicates or disagree with the raw URL.
    if (values.size && (values.size !== nodeValues.size || [...values].some(([k, v]) => nodeValues.get(k) !== v))) invalid('query');
    if (!values.size) return nodeValues;
  }
  return values;
}

export function parseApiRequest<T>(req: unknown, schema: QuerySchema<T>) {
  if (!record(req)) return invalid('request');
  if (typeof req.method !== 'string' || !/^[A-Z]+$/.test(req.method)) invalid('method');
  if (req.method !== 'GET' && req.method !== 'OPTIONS') throw new RequestValidationError('method', 405, 'METHOD_NOT_ALLOWED');
  // These APIs have no body contract. Do not read/parse an unbounded stream to reject it.
  const lengths = headerValues(req, 'content-length');
  if (lengths.length > 1 || lengths.some((v) => v !== '0') || headerValues(req, 'transfer-encoding').length || req.body != null) invalid('body');
  const accountKey = readRequestAccountKey(req);
  const query = queryValues(req);
  if (req.method === 'OPTIONS') return { preflight: true as const, accountKey, query: undefined };
  return { preflight: false as const, accountKey, query: schema(query) };
}
