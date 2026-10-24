import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseApiRequest, readRequestAccountKey, requestSchemas, RequestValidationError } from '../server/http/requestSchemas.ts';
import { withRequestSchema } from '../server/http/validateRequest.ts';
import { readdirSync, readFileSync } from 'node:fs';

// No local env files, real keys or live providers. Every fetch is intercepted.
process.env.LTA_ACCOUNT_KEY = 'request-schema-synthetic-only';
process.env.SPEED_PAGE_CONCURRENCY = '1';
process.env.SPEED_MAX_PAGES = '1';
const names = ['traffic', 'trafficflow', 'vms', 'traveltimes', 'trafficimages', 'expresswayspeeds',
  'health', 'rainforecast', '_forecast24h', 'airquality', 'imageproxy', 'live',
  '_carparks', '_roadconditions', '_weatheralerts', '_floods'];
const routes = await Promise.all(names.map(async (name) => ({ name, module: await import(`../api/${name}.ts`) })));
const get = (url = '/api/test', rest: Record<string, unknown> = {}) => ({ method: 'GET', url, ...rest });
function nodeResponse() {
  return {
    statusCode: 0, body: undefined as any, headers: {} as Record<string, string>,
    setHeader(name: string, value: string) { this.headers[name.toLowerCase()] = value; },
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
    end(body?: unknown) { this.body = body; return this; },
    send(body: unknown) { this.body = body; return this; },
  };
}

test('every callable API module participates in the request-boundary matrix', () => {
  const actual = readdirSync(new URL('../api/', import.meta.url))
    .filter((name) => name.endsWith('.ts') && /export default/.test(readFileSync(new URL('../api/' + name, import.meta.url), 'utf8')))
    .map((name) => name.slice(0, -3)).sort();
  assert.deepEqual([...names].sort(), actual);
});

for (const mode of ['web', 'node']) {
  test(`all ${mode} routes reject invalid methods, bodies, queries and credentials before any provider work`, async () => {
    const originalFetch = globalThis.fetch, originalLog = console.error;
    let calls = 0;
    const logs: unknown[] = [];
    globalThis.fetch = async () => { calls++; throw new Error('No provider should run'); };
    console.error = (...args) => { logs.push(args); };
    try {
      for (const { name, module } of routes) {
        for (const [request, expected] of [
          [get('/api/' + name, { method: 'POST', body: { private: 'synthetic-private-marker' } }), 405],
          [get('/api/' + name + '?unexpected=synthetic-private-marker'), 400],
          [get('/api/' + name, { body: { private: 'synthetic-private-marker' } }), 400],
          [get('/api/' + name, { headers: { 'content-length': '1' } }), 400],
          [get('/api/' + name, { headers: { accountkey: ['synthetic-private-marker'] } }), 400],
          [get('/api/' + name, { headers: { accountkey: 'bad\r\nsynthetic-private-marker' } }), 400],
          [get('/api/' + name + '?include=%FF'), 400],
        ] as const) {
          const res = mode === 'node' ? nodeResponse() : undefined;
          const response = await module.default(request, res) as Response;
          const status = res ? res.statusCode : response.status;
          const body = res ? res.body : await response.json();
          const headers = res ? res.headers : Object.fromEntries(response.headers);
          assert.equal(status, expected, name);
          assert.equal(body.success, false, name);
          assert.equal(headers['cache-control'], 'no-store', name);
          assert.ok(!JSON.stringify([body, logs]).includes('synthetic-private-marker'), name);
          if (expected === 405) assert.equal(headers.allow, 'GET, OPTIONS', name);
          assert.equal(calls, 0, name);
        }
        // Named Web exports must not provide an unguarded alternative.
        if (module.GET) {
          const response = await module.GET(new Request('https://example.test/api/' + name + '?unknown=1'));
          assert.equal(response.status, 400, name);
        }
        const res = mode === 'node' ? nodeResponse() : undefined;
        const response = await module.default({ method: 'OPTIONS', url: '/api/' + name }, res) as Response;
        assert.equal(res ? res.statusCode : response.status, 204, name);
        assert.equal(res ? res.headers['access-control-allow-methods'] : response.headers.get('access-control-allow-methods'), 'GET, OPTIONS', name);
      }
      assert.equal(calls, 0);
      assert.deepEqual(logs, []);
    } finally { globalThis.fetch = originalFetch; console.error = originalLog; }
  });
}

test('query schemas reject ambiguous/coerced values and retain their exact valid contracts', () => {
  for (const value of ['', '-1', '+1', '1.5', '1e3', ' 500', '00', '2147483648', '9'.repeat(200)]) {
    assert.throws(() => parseApiRequest(get('/api/traffic?$skip=' + encodeURIComponent(value)), requestSchemas.lta), RequestValidationError);
  }
  for (const url of ['/api/traffic?$skip=0&$skip=500', '/api/traffic?$skip=0&%24skip=500', '/api/traffic?%ZZ=1', '/api/traffic?x=%FF'])
    assert.throws(() => parseApiRequest(get(url), requestSchemas.lta), RequestValidationError);
  for (const query of [{ $skip: ['0', '500'] }, { $skip: { nested: '0' } }, { $skip: 0 }, { $skip: null }])
    assert.throws(() => parseApiRequest(get('/api/traffic', { query }), requestSchemas.lta), RequestValidationError);
  assert.throws(() => parseApiRequest(get('/api/traffic?$skip=0', { query: { $skip: '500' } }), requestSchemas.lta), RequestValidationError);
  assert.throws(() => parseApiRequest(get('/api/traffic?$filter=true'), requestSchemas.lta), RequestValidationError);
  assert.throws(() => parseApiRequest(get('/api/test?' + 'x'.repeat(16384)), requestSchemas.empty), RequestValidationError);
  assert.throws(() => parseApiRequest(get('/api/live'), requestSchemas.live), RequestValidationError);
  for (const feed of ['constructor', '__proto__', '', 'FLOODS'])
    assert.throws(() => parseApiRequest(get('/api/live?feed=' + feed), requestSchemas.live), RequestValidationError);
  for (const include of ['', 'segments,other', 'other', 'Segments'])
    assert.throws(() => parseApiRequest(get('/api/expresswayspeeds?include=' + include), requestSchemas.speeds), RequestValidationError);
  for (const skip of [0, 500, 2_147_483_647])
    assert.equal(parseApiRequest(get('/api/traffic?$skip=' + skip), requestSchemas.lta).query?.skip, skip);
  assert.equal(parseApiRequest(new Request('https://example.test/api/expresswayspeeds?include=segments'), requestSchemas.speeds).query?.includeSegments, true);
  for (const feed of ['floods', 'weatheralerts', 'carparks', 'roadconditions'])
    assert.equal(parseApiRequest(get('/api/live?feed=' + feed), requestSchemas.live).query?.feed, feed);
});

test('credential aliases are bounded scalars with consistent Node and Web semantics', () => {
  const key = 'synthetic/+key=';
  for (const headers of [{ AccountKey: key }, { 'x-lta-account-key': key }, new Headers({ accountkey: key }),
    { accountkey: key, 'x-account-key': key }]) assert.equal(readRequestAccountKey({ headers }), key);
  for (const headers of [{ accountkey: '' }, { accountkey: ' ' + key }, { accountkey: 'x'.repeat(513) },
    { accountkey: key + ',' + key }, { accountkey: key, 'x-account-key': 'different' }, { accountkey: {} }])
    assert.throws(() => readRequestAccountKey({ headers }), RequestValidationError);
  const headers = new Headers(); headers.append('accountkey', key); headers.append('accountkey', key);
  assert.throws(() => readRequestAccountKey({ headers }), RequestValidationError);
  assert.throws(() => readRequestAccountKey({ headers: { accountkey: key }, rawHeaders: ['AccountKey', key, 'AccountKey', key] }), RequestValidationError);
});

test('proxy input rejects malformed URLs and unsafe destinations before transport, preserving signed bytes', async () => {
  const proxy = routes.find((r) => r.name === 'imageproxy')!.module.default;
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (url) => { calls.push(String(url)); return new Response(new Uint8Array([1, 2, 3])); };
  try {
    for (const url of ['', 'not-a-url', 'https://images.data.gov.sg/bad%ZZ', 'https://images.data.gov.sg/a b',
      'http://images.data.gov.sg/x', 'https://images.data.gov.sg.evil.test/x', 'https://user:pass@images.data.gov.sg/x',
      'https://images.data.gov.sg:444/x', 'https://images.data.gov.sg/x#fragment', 'https://127.0.0.1/x',
      'https://images.data.gov.sg/' + 'x'.repeat(8192)]) {
      const response = await proxy(get('/api/imageproxy?url=' + encodeURIComponent(url))) as Response;
      assert.ok([400, 403].includes(response.status));
    }
    assert.equal((await proxy(get('/api/imageproxy?url=a&url=b')) as Response).status, 400);
    assert.equal(calls.length, 0);
    const signed = 'https://images.data.gov.sg/current.jpg?signature=synthetic%2B%2F%3D&part=1+2';
    const response = await proxy(new Request('https://example.test/api/imageproxy?url=' + encodeURIComponent(signed))) as Response;
    assert.equal(response.status, 200);
    assert.deepEqual(calls, [signed]);
    assert.equal((await response.arrayBuffer()).byteLength, 3);
  } finally { globalThis.fetch = original; }
});

test('LTA forwarding uses only validated pagination and Web credential headers', async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (url) => { calls.push(String(url)); return Response.json({ value: [] }); };
  try {
    for (const name of ['traffic', 'trafficflow', 'vms', 'traveltimes']) {
      const route = routes.find((r) => r.name === name)!.module.default;
      const response = await route(new Request('https://example.test/api/' + name + '?$skip=500', { headers: { AccountKey: 'synthetic-header' } }));
      assert.equal(response.status, 200);
      assert.deepEqual([...new URL(calls.at(-1)!).searchParams], [['$skip', '500']]);
    }
    assert.equal(calls.length, 4);
  } finally { globalThis.fetch = original; }
});

test('the shared guard never enters business logic on a bad request or preflight', async () => {
  let businessCalls = 0;
  const guard = withRequestSchema(requestSchemas.speeds, (_req, _res, input) => {
    businessCalls++; return Response.json(input.query);
  });
  for (const request of [null, {}, get('/api/test', { method: 'get' }), get('/api/test', { headers: { 'transfer-encoding': 'chunked' } }),
    get('/api/test', { headers: { 'content-length': 'not-a-number' } }), get('/api/test?include=other'),
    new Request('https://example.test/api/test', { method: 'POST', body: '{}' })]) {
    assert.ok((await guard(request) as Response).status >= 400);
  }
  assert.equal((await guard({ method: 'OPTIONS', url: '/api/test' }) as Response).status, 204);
  assert.equal(businessCalls, 0);
  assert.equal((await guard(get('/api/test?include=segments')) as Response).status, 200);
  assert.equal(businessCalls, 1);
});
