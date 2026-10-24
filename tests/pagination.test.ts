import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { serviceWorkerSource, workerGlobals } from './helpers/serviceWorker.ts';
import assert from 'node:assert/strict';
import { listQuery, parseApiRequest, requestSchemas, RequestValidationError } from '../server/http/requestSchemas.ts';
import { paginateList, paginateProviderList, withListResponse } from '../server/http/listPagination.ts';
import { LIST_PAGINATION } from '../config/policy.ts';

const parse = (search: string, fields: readonly string[] = ['rows']) => parseApiRequest(
  new Request('https://example.test/api/list' + search), listQuery(requestSchemas.empty, fields)).query;
const source = { success: true, issuedAt: '2026-10-24T01:00:00Z', rows: Array.from({ length: 7 }, (_, id) => ({ id })) };
const first = () => paginateList(source, { collection: 'rows', offset: 0, limit: 3 }, 'test', ['rows']);
const token = () => (first().body as any).pagination.snapshot as string;

test('pagination is opt-in, bounded and explicit about collections; numeric coercion is rejected', () => {
  assert.equal(parse('')?.page, null);
  assert.deepEqual(parse('?limit=2')?.page, { collection: 'rows', offset: 0, limit: 2 });
  assert.equal(parse('?offset=0')?.page?.limit, LIST_PAGINATION.defaultLimit);
  for (const field of ['limit', 'offset']) for (const bad of ['', '-1', '+1', '1.2', '1e2', ' 2', '02', '9'.repeat(100)])
    assert.throws(() => parse('?' + field + '=' + encodeURIComponent(bad)), RequestValidationError);
  for (const q of ['?limit=0', '?limit=501', '?offset=1000001', '?offset=1', '?limit=2&limit=3', '?cursor=fake', '?snapshot=wrong', '?snapshot=' + 'a'.repeat(65)])
    assert.throws(() => parse(q), RequestValidationError);
  assert.throws(() => parse('?limit=2', ['one', 'two']), RequestValidationError);
  assert.throws(() => parse('?collection=__proto__'), RequestValidationError);
  assert.throws(() => parse('?collection=toString'), RequestValidationError);
  assert.deepEqual(parse('?collection=two', ['one', 'two'])?.page, { collection: 'two', offset: 0, limit: 100 });
});

test('first, middle, last and beyond-end pages retain source metadata and have correct totals/navigation', () => {
  const firstPage: any = first().body;
  assert.equal(firstPage.issuedAt, source.issuedAt);
  assert.deepEqual(firstPage.rows, [{ id: 0 }, { id: 1 }, { id: 2 }]);
  assert.deepEqual(firstPage.pagination, { mode: 'offset', consistency: 'snapshot', collection: 'rows', offset: 0,
    limit: 3, count: 3, total: 7, hasMore: true, nextOffset: 3, previousOffset: null, snapshot: token() });
  const ids: number[] = [];
  for (const offset of [0, 3, 6]) {
    const page: any = paginateList(source, { collection: 'rows', offset, limit: 3, snapshot: token() }, 'test', ['rows']).body;
    ids.push(...page.rows.map((r: any) => r.id));
    if (offset === 6) { assert.equal(page.pagination.nextOffset, null); assert.equal(page.pagination.previousOffset, 3); }
  }
  assert.deepEqual(ids, source.rows.map(r => r.id)); assert.equal(new Set(ids).size, 7);
  const beyond: any = paginateList(source, { collection: 'rows', offset: 100, limit: 3, snapshot: token() }, 'test', ['rows']).body;
  assert.deepEqual(beyond.rows, []); assert.equal(beyond.pagination.hasMore, false); assert.equal(beyond.pagination.previousOffset, 6);
});

test('empty lists are valid, unavailable lists stay unavailable, and malformed lists fail validation', () => {
  const empty: any = paginateList({ rows: [] }, { collection: 'rows', offset: 0, limit: 2 }, 'test', ['rows']).body;
  assert.equal(empty.pagination.total, 0); assert.equal(empty.pagination.nextOffset, null);
  const unavailable = paginateList({ rows: null }, { collection: 'rows', offset: 0, limit: 2 }, 'test', ['rows']);
  assert.equal(unavailable.status, 503); assert.equal(unavailable.headers['Cache-Control'], 'no-store');
  assert.throws(() => paginateList({ rows: {} }, { collection: 'rows', offset: 0, limit: 2 }, 'test', ['rows']));
});

test('insertions, deletions, reordering and content changes return safe 409 instead of mixing snapshots', () => {
  for (const rows of [[{ id: 99 }, ...source.rows], source.rows.slice(1), [...source.rows].reverse(), source.rows.map(r => ({ id: r.id + 1 }))]) {
    const result = paginateList({ ...source, rows }, { collection: 'rows', offset: 3, limit: 3, snapshot: token() }, 'test', ['rows']);
    assert.equal(result.status, 409); assert.equal((result.body as any).code, 'PAGINATION_SNAPSHOT_CHANGED');
    assert.ok(!JSON.stringify(result.body).includes(token())); assert.equal(result.headers['Cache-Control'], 'no-store');
  }
});

test('snapshot tokens scope the collection/route, preserve order and do not depend on renewed receipt times', () => {
  const page = { collection: 'rows', offset: 3, limit: 3, snapshot: token() };
  assert.equal(paginateList({ ...source, issuedAt: '2026-10-24T02:00:00Z' }, page, 'test', ['rows']).status, 200);
  assert.equal(paginateList(source, page, 'another', ['rows']).status, 409);
  assert.equal(paginateList({ other: source.rows }, { ...page, collection: 'other' }, 'test', ['other']).status, 409);
});

test('multi-list pages omit sibling arrays, including geometry, without changing the source object', () => {
  const data = { ...source, other: Array(100).fill('not requested') };
  const result: any = paginateList(data, { collection: 'rows', offset: 0, limit: 1 }, 'test', ['rows', 'other']).body;
  assert.ok(!('other' in result)); assert.equal(data.other.length, 100); assert.equal(data.rows.length, 7);
});

test('LTA request schema preserves legacy skip, rejects ambiguous aliases and bounds new limit/offset', () => {
  const parseNative = (s: string) => parseApiRequest(new Request('https://example.test/api/traffic' + s), requestSchemas.lta).query;
  assert.deepEqual(parseNative('?$skip=2147483647'), { skip: 2147483647 });
  assert.deepEqual(parseNative('?limit=3&offset=12'), { skip: 12, page: { limit: 3, offset: 12 } });
  assert.deepEqual(parseNative('?$skip=12&limit=3'), { skip: 12, page: { limit: 3, offset: 12 } });
  for (const s of ['?$skip=0&offset=0', '?limit=501', '?limit=0', '?offset=1000001', '?offset=-1', '?limit=1&$skip=2147483647', '?snapshot=' + token(), '?collection=value'])
    assert.throws(() => parseNative(s), RequestValidationError);
});

test('native provider pages report unknown total/live consistency and never fabricate a snapshot or exact full-page end', () => {
  const page: any = paginateProviderList({ value: source.rows }, { offset: 12, limit: 3 });
  assert.deepEqual(page.value, source.rows.slice(0, 3)); assert.equal(page.pagination.total, null);
  assert.equal(page.pagination.consistency, 'live'); assert.equal(page.pagination.snapshot, null);
  assert.equal(page.pagination.nextOffset, 15);
  const last: any = paginateProviderList({ value: [{ id: 1 }] }, { offset: 100, limit: 2 });
  assert.equal(last.pagination.hasMore, false); assert.equal(last.pagination.nextOffset, null);
  const full: any = paginateProviderList({ value: Array(500).fill({}) }, { offset: 0, limit: 500 });
  assert.equal(full.pagination.hasMore, true); assert.equal(full.pagination.nextOffset, 500);
  const cap: any = paginateProviderList({ value: Array(500).fill({}) }, { offset: 1000000, limit: 500 });
  assert.equal(cap.pagination.nextOffset, null); assert.equal(cap.pagination.limitReached, true);
});

test('paginated sender preserves legacy payload/cache, CORS and no-store conflicts in both transports', async () => {
  const route = withListResponse(requestSchemas.empty, 'test', ['rows'], async (_req, _res, { send }) => send(200, source, { 'Cache-Control': 'public, max-age=0', 'Vercel-CDN-Cache-Control': 'max-age=60', 'Retry-After': '10' }));
  for (const node of [false, true]) {
    const invoke = async (search: string) => {
      const res = node ? { statusCode: 0, body: undefined as any, headers: {} as Record<string, string>,
        setHeader(k: string, v: string) { this.headers[k.toLowerCase()] = v; }, status(n: number) { this.statusCode = n; return this; },
        json(body: any) { this.body = body; return this; } } : undefined;
      const r = await route(new Request('https://example.test/api/list' + search, { headers: { Origin: 'https://live-traffic-carbon-bc04.vercel.app' } }), res) as Response;
      return { status: res ? res.statusCode : r.status, body: res ? res.body : await r.json(), headers: res ? res.headers : Object.fromEntries(r.headers) };
    };
    const legacy = await invoke(''); assert.deepEqual(legacy.body, source); assert.equal(legacy.headers['vercel-cdn-cache-control'], 'max-age=60');
    const first = await invoke('?limit=3'); assert.equal(first.status, 200); assert.equal(first.body.rows.length, 3);
    assert.equal(first.headers['access-control-allow-origin'], 'https://live-traffic-carbon-bc04.vercel.app');
    assert.equal(first.headers['vercel-cdn-cache-control'], 'no-store'); assert.equal(first.headers['retry-after'], '10');
    const bad = await invoke('?offset=3&snapshot=' + 'a'.repeat(64)); assert.equal(bad.status, 409); assert.equal(bad.headers['cache-control'], 'no-store');
  }
});


test('service worker pages are network-only, never use offline copies or retain token URLs, and keep ordinary feed caching', async () => {
  const handlers: Record<string, (event: any) => void> = {};
  let matches = 0, puts = 0, network = 0, offline = false;
  runInNewContext(await serviceWorkerSource(), {
    ...workerGlobals(), self: { location: { origin: 'https://fixture.test' }, addEventListener: (name: string, run: any) => { handlers[name] = run; } },
    fetch: async () => { network++; if (offline) throw new Error('synthetic offline'); return Response.json({ value: [] }); },
    caches: { match: async () => { matches++; return Response.json({ stale: true }); }, open: async () => ({ put: async () => { puts++; } }) },
  });
  const load = (path: string) => {
    let pending!: Promise<Response>;
    handlers.fetch({ request: new Request('https://fixture.test' + path), respondWith: (p: Promise<Response>) => { pending = p; } });
    return pending;
  };
  for (const key of ['limit', 'offset', 'collection', 'snapshot']) {
    offline = false; assert.equal((await load('/api/traffic?' + key + '=fixture')).status, 200);
    offline = true; await assert.rejects(load('/api/traffic?' + key + '=fixture'));
  }
  assert.equal(network, 8); assert.equal(matches, 0); assert.equal(puts, 0);
  offline = false; await load('/api/traffic'); assert.equal(puts, 1);
  offline = true; const fallback = await load('/api/traffic'); assert.equal(fallback.headers.get('X-TrafficPulse-Offline'), '1');
  assert.equal(matches, 1); assert.equal(puts, 1);
});
