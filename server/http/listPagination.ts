import { LIST_PAGINATION } from '../../config/policy.ts';
import { createHash } from 'node:crypto';
import { InvalidPayloadError } from '../../shared/diagnostics.ts';
import { listQuery, type ListPage, type QuerySchema } from './requestSchemas.ts';
import { withRequestSchema } from './validateRequest.ts';
import { NO_STORE, sendJson } from './responses.ts';

// New paged replies always verify their live snapshot at origin; source service caches still apply.
const PAGE_HEADERS: Record<string, string> = { ...NO_STORE, 'Vercel-CDN-Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store' };
const failure = (status: number, code: string, error: string) => ({ status, body: { success: false, code, error }, headers: PAGE_HEADERS });

/** Slice one named collection; preserve scalar/observation metadata and omit sibling lists. */
export function paginateList(body: Record<string, any>, page: ListPage, scope: string, collections: readonly string[]) {
  const rows = body[page.collection];
  if (rows === null) return failure(503, 'PAGINATION_COLLECTION_UNAVAILABLE', 'Requested list is unavailable. Retry later.');
  if (!Array.isArray(rows)) throw new InvalidPayloadError();
  // Content + order is the revision. No server snapshot registry, secret, timestamp renewal or signed cursor.
  const snapshot = createHash('sha256').update(JSON.stringify(['list-v1', scope, page.collection, rows])).digest('hex');
  if (page.snapshot !== undefined && page.snapshot !== snapshot)
    return failure(409, 'PAGINATION_SNAPSHOT_CHANGED', 'List changed. Restart from offset 0 without a snapshot token.');
  const selected = rows.slice(page.offset, page.offset + page.limit);
  const hasMore = page.offset + selected.length < rows.length;
  const metadata = Object.fromEntries(Object.entries(body).filter(([key]) => !collections.includes(key)));
  return { status: 200, headers: PAGE_HEADERS, body: {
    ...metadata, [page.collection]: selected,
    pagination: { mode: 'offset', consistency: 'snapshot', collection: page.collection, offset: page.offset,
      limit: page.limit, count: selected.length, total: rows.length, hasMore,
      nextOffset: hasMore ? page.offset + selected.length : null,
      previousOffset: page.offset ? Math.max(0, Math.min(page.offset - page.limit, Math.floor(Math.max(0, rows.length - 1) / page.limit) * page.limit)) : null,
      snapshot },
  } };
}

type Sender = (status: number, body: any, cache?: Record<string, string>) => any;
/** Validate pagination before provider logic; use the same CORS/error boundary and sender in Node/Web. */
export function withListResponse<T>(schema: QuerySchema<T>, scope: string, collections: readonly string[],
  handler: (req: any, res: any, input: { query: T; accountKey: string | null; send: Sender }) => any,
  available?: (query: T) => readonly string[],
) {
  return withRequestSchema(listQuery(schema, collections, available), async (req, res, input) => {
    const send: Sender = (status, body, cache = NO_STORE) => {
      if (status !== 200 || input.query.page === null) return sendJson(res, status, body, cache);
      const paged = paginateList(body, input.query.page, scope, collections);
      return sendJson(res, paged.status, paged.body, { ...cache, ...paged.headers });
    };
    return handler(req, res, { query: input.query.base, accountKey: input.accountKey, send });
  });
}

/** Native LTA list: one provider window, unknown total, no invented snapshot/keyset guarantee. */
export function paginateProviderList(body: Record<string, any>, page: { offset: number; limit: number }) {
  if (!Array.isArray(body.value) || body.value.length > 500) throw new InvalidPayloadError();
  const selected = body.value.slice(0, page.limit);
  const hasMore = body.value.length > selected.length || body.value.length === 500;
  return { ...body, value: selected, pagination: {
    mode: 'offset', consistency: 'live', collection: 'value', offset: page.offset, limit: page.limit,
    count: selected.length, total: null, hasMore,
    nextOffset: hasMore && page.offset + selected.length <= LIST_PAGINATION.maxOffset ? page.offset + selected.length : null,
    previousOffset: page.offset ? Math.max(0, page.offset - page.limit) : null, snapshot: null,
    limitReached: hasMore && page.offset + selected.length > LIST_PAGINATION.maxOffset,
  } };
}
export { PAGE_HEADERS };
