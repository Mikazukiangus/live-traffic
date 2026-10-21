import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createConfig, createPublicConfig } from '../config/schema.ts';
import { requestSchemas } from '../server/http/requestSchemas.ts';

// Isolated process: no local env files, real credentials or live provider access.
process.env.API_CORS_ORIGINS = 'https://frontend.example.test,https://second.example.test';
process.env.LTA_ACCOUNT_KEY = 'cors-synthetic-only';
process.env.DATA_GOV_MIN_INTERVAL_MS = '0';
process.env.SPEED_PAGE_CONCURRENCY = '1';
process.env.SPEED_MAX_PAGES = '1';
const { withRequestSchema } = await import('../server/http/validateRequest.ts');
const { corsHeaders, setWebCors, setNodeCors } = await import('../server/http/cors.ts');
const { markLocalCorsRequest } = await import('../server/http/localCors.ts');
const allowed = 'https://frontend.example.test';
const names = readdirSync(new URL('../api/', import.meta.url))
  .filter((name) => name.endsWith('.ts') && /export default/.test(readFileSync(new URL('../api/' + name, import.meta.url), 'utf8')))
  .map((name) => name.slice(0, -3));
const routes = await Promise.all(names.map(async (name) => ({ name, module: await import(`../api/${name}.ts`) })));
const get = (url: string, headers: Record<string, unknown> = {}, method = 'GET') => ({ method, url, headers });
function nodeResponse() {
  return {
    statusCode: 0, body: undefined as any, headers: {} as Record<string, string>,
    setHeader(name: string, value: string) { this.headers[name.toLowerCase()] = value; },
    getHeader(name: string) { return this.headers[name.toLowerCase()]; },
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
    end(body?: unknown) { this.body = body; return this; },
    send(body: unknown) { this.body = body; return this; },
  };
}
const noCredentials = (headers: Record<string, string>) => {
  assert.equal(headers['access-control-allow-credentials'], undefined);
  assert.ok(!Object.values(headers).includes('*'));
};

test('CORS config defaults to exact deployment origins with bounded validated extras and local-only loopback', () => {
  const c = createConfig();
  assert.deepEqual(c.server.corsOrigins, [c.siteUrl]);
  assert.ok(Object.isFrozen(c.server.corsOrigins));
  const origins = createConfig({ API_CORS_ORIGINS: `${allowed}, https://second.example.test,${allowed}`,
    API_CORS_ORIGIN: 'https://legacy.example.test', VERCEL: '1', VERCEL_ENV: 'preview',
    VERCEL_URL: 'project-exact.vercel.app', VERCEL_BRANCH_URL: 'project-branch.vercel.app',
    VERCEL_PROJECT_PRODUCTION_URL: 'project.example.test' }).server.corsOrigins;
  for (const origin of [allowed, 'https://second.example.test', 'https://legacy.example.test',
    'https://project-exact.vercel.app', 'https://project-branch.vercel.app', 'https://project.example.test'])
    assert.ok(origins.includes(origin), origin);
  assert.equal(origins.filter((origin) => origin === allowed).length, 1);
  assert.ok(!origins.includes('https://another-project.vercel.app'));
  assert.ok(!createConfig({ VERCEL_URL: 'ignored.vercel.app' }).server.corsOrigins.includes('https://ignored.vercel.app'));
  for (const NODE_ENV of ['development', 'test']) {
    const local = createConfig({ NODE_ENV, DEV_PORT: '3500', PREVIEW_PORT: '4500' }).server.corsOrigins;
    for (const host of ['localhost', '127.0.0.1', '[::1]']) for (const port of [3500, 4500])
      assert.ok(local.includes(`http://${host}:${port}`));
    assert.ok(!local.includes('http://localhost:3000'));
  }
  for (const env of [{ NODE_ENV: 'production' }, { NODE_ENV: 'development', VERCEL: '1' }, { NODE_ENV: 'test', VERCEL_ENV: 'preview' }])
    assert.ok(createConfig(env).server.corsOrigins.every((origin) => origin.startsWith('https:')));
  assert.ok(!JSON.stringify(createPublicConfig({ API_CORS_ORIGINS: allowed })).includes(allowed));
});

test('unsafe origin settings fail early without including supplied values', () => {
  for (const key of ['API_CORS_ORIGINS', 'API_CORS_ORIGIN']) for (const value of [
    '*', 'null', 'https://*.example.test', 'https://example.test/private-marker',
    'https://private-marker@example.test', 'https://example.test?private-marker=1',
    'http://private-marker.example.test', 'http://localhost:3100', 'https://example.test#private-marker',
    'https://example.test\\private-marker', 'https://private-marker.test\r\nhttps://example.test',
  ]) assert.throws(() => createConfig({ [key]: value }), (error: unknown) => {
    assert.ok(error instanceof Error); assert.match(error.message, /API_CORS_ORIGIN/);
    assert.ok(!error.message.includes('private-marker')); return true;
  });
  for (const value of [',', `${allowed},`, Array(33).fill(allowed).join(',')])
    assert.throws(() => createConfig({ API_CORS_ORIGINS: value }), /API_CORS_ORIGINS/);
  for (const key of ['VERCEL_URL', 'VERCEL_BRANCH_URL', 'VERCEL_PROJECT_PRODUCTION_URL'])
    for (const value of ['https://private-marker.test', 'private-marker.test/path', '*.private-marker.test'])
      assert.throws(() => createConfig({ VERCEL: '1', [key]: value }), (error: unknown) => {
        assert.ok(error instanceof Error); assert.ok(error.message.includes(key));
        assert.ok(!error.message.includes('private-marker')); return true;
      });
  assert.ok(createConfig({ NODE_ENV: 'test', API_CORS_ORIGINS: 'http://localhost:3500' }).server.corsOrigins.includes('http://localhost:3500'));
});

for (const mode of ['node', 'web']) {
  test(`all ${mode} routes deny untrusted/ambiguous origins and unsafe preflights before provider work`, async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error('Provider must not run'); };
    const denied = ['https://outside.test', 'null', '*', `${allowed}.outside.test`, `${allowed}/`,
      'https://another-project.vercel.app', `${allowed}, ${allowed}`, [allowed], ''];
    try {
      assert.equal(routes.length, 16);
      for (const { name, module } of routes) {
        const requests = [
          ...denied.map((origin) => get('/api/' + name, { origin })),
          get('/api/' + name, { origin: allowed, 'access-control-request-method': 'POST' }, 'OPTIONS'),
          get('/api/' + name, { origin: allowed, 'access-control-request-method': 'GET', 'access-control-request-headers': 'X-Unknown' }, 'OPTIONS'),
          get('/api/' + name, { origin: allowed, 'access-control-request-method': 'GET', 'access-control-request-headers': 'Authorization' }, 'OPTIONS'),
          { ...get('/api/' + name, { origin: allowed }), rawHeaders: ['Origin', allowed, 'Origin', allowed] },
          get('/api/' + name, { origin: allowed, Origin: allowed }),
          get('/api/' + name, { 'access-control-request-method': 'GET' }, 'OPTIONS'),
          get('/api/' + name, { origin: allowed }, 'OPTIONS'),
        ];
        for (const request of requests) {
          const res = mode === 'node' ? nodeResponse() : undefined;
          const response = await module.default(request, res) as Response;
          const status = res ? res.statusCode : response.status;
          const headers = res ? res.headers : Object.fromEntries(response.headers);
          const body = res ? res.body : await response.json();
          assert.ok(status === 400 || status === 403, name);
          assert.equal(headers['access-control-allow-origin'], undefined, name);
          assert.match(headers.vary, /Origin/);
          assert.equal(headers['cache-control'], 'no-store');
          assert.ok(!JSON.stringify(body).includes('outside.test'));
          noCredentials(headers);
        }
        for (const origin of [undefined, allowed, 'https://second.example.test']) {
          const headers: Record<string, string> = origin ? { origin, 'access-control-request-method': 'GET',
            'access-control-request-headers': 'content-type, AccountKey, X-LTA-Account-Key, x-account-key' } : {};
          const res = mode === 'node' ? nodeResponse() : undefined;
          const response = await module.default(get('/api/' + name, headers, 'OPTIONS'), res) as Response;
          const actual = res ? res.headers : Object.fromEntries(response.headers);
          assert.equal(res ? res.statusCode : response.status, 204);
          assert.equal(actual['access-control-allow-origin'], origin);
          assert.equal(actual['access-control-allow-methods'], 'GET, OPTIONS');
          assert.equal(actual['cache-control'], 'no-store');
          for (const vary of ['Origin', 'Access-Control-Request-Method', 'Access-Control-Request-Headers']) assert.ok(actual.vary.includes(vary));
          noCredentials(actual);
        }
        if (module.GET) assert.equal((await module.GET(new Request('https://api.example.test/api/' + name,
          { headers: { Origin: 'https://outside.test' } }))).status, 403);
      }
      assert.equal(calls, 0);
    } finally { globalThis.fetch = original; }
  });

  test(`${mode} CORS applies to JSON/binary success, provider errors and input errors while preserving caches`, async () => {
    const original = globalThis.fetch, originalError = console.error;
    const urls: string[] = [];
    let fail = false;
    globalThis.fetch = async (url) => {
      urls.push(String(url));
      if (fail) return new Response('synthetic failure', { status: 503 });
      if (String(url).startsWith('https://images.data.gov.sg/')) return new Response(new Uint8Array([1, 2, 3]));
      return Response.json({ value: [] });
    };
    console.error = () => {};
    try {
      for (const name of ['traffic', 'trafficimages', 'expresswayspeeds', 'imageproxy']) {
        const route = routes.find((r) => r.name === name)!.module.default;
        const path = '/api/' + name + (name === 'imageproxy' ? '?url=' + encodeURIComponent('https://images.data.gov.sg/synthetic.jpg?signature=kept%2B') : '');
        for (const origin of [undefined, allowed, 'https://second.example.test']) {
          const res = mode === 'node' ? nodeResponse() : undefined;
          const response = await route(get(path, origin ? { origin } : {}), res) as Response;
          const headers = res ? res.headers : Object.fromEntries(response.headers);
          assert.equal(res ? res.statusCode : response.status, 200, name);
          assert.equal(headers['access-control-allow-origin'], origin);
          assert.equal(headers.vary, 'Origin');
          assert.ok(headers['cache-control'].startsWith('public'));
          assert.ok(headers['vercel-cdn-cache-control'].includes('max-age='));
          noCredentials(headers);
          if (name === 'imageproxy') {
            assert.equal(headers['content-type'], 'image/jpeg');
            assert.equal(res ? res.body.byteLength : (await response.arrayBuffer()).byteLength, 3);
          }
        }
      }
      assert.ok(urls.some((url) => url.endsWith('signature=kept%2B')), 'signed bytes changed');
      for (const name of ['traffic', 'imageproxy', 'forecast24h', 'airquality']) {
        fail = true;
        const path = '/api/' + name + (name === 'imageproxy' ? '?url=' + encodeURIComponent('https://images.data.gov.sg/synthetic.jpg') : '');
        const res = mode === 'node' ? nodeResponse() : undefined;
        const response = await routes.find((r) => r.name === name)!.module.default(get(path, { origin: allowed }), res) as Response;
        const headers = res ? res.headers : Object.fromEntries(response.headers);
        assert.ok((res ? res.statusCode : response.status) >= 500);
        assert.equal(headers['access-control-allow-origin'], allowed);
        assert.equal(headers.vary, 'Origin');
        assert.equal(headers['cache-control'], 'no-store');
      }
      const before = urls.length;
      for (const method of ['GET', 'POST']) {
        const res = mode === 'node' ? nodeResponse() : undefined;
        const response = await routes[0].module.default(get('/api/test?unknown=1', { origin: allowed }, method), res) as Response;
        const headers = res ? res.headers : Object.fromEntries(response.headers);
        assert.equal(res ? res.statusCode : response.status, method === 'GET' ? 400 : 405);
        assert.equal(headers['access-control-allow-origin'], allowed);
        assert.equal(headers.vary, 'Origin');
      }
      assert.equal(urls.length, before);
    } finally { globalThis.fetch = original; console.error = originalError; }
  });
}

test('origin matching ignores Host/Forwarded headers; decoration preserves existing Vary tokens', async () => {
  assert.throws(() => corsHeaders(get('/api/test', { origin: 'https://outside.test', host: 'outside.test',
    'x-forwarded-host': 'outside.test' })), /Invalid request/);
  const original = Response.json({ ok: true }, { headers: { Vary: 'Accept-Encoding, origin', 'Cache-Control': 'public, max-age=60' } });
  const decorated = setWebCors(original, corsHeaders(get('/api/test', { origin: allowed })));
  assert.equal(decorated.headers.get('Vary'), 'Accept-Encoding, Origin');
  assert.equal(decorated.headers.get('Cache-Control'), 'public, max-age=60');
  assert.deepEqual(await decorated.json(), { ok: true });
  const res = nodeResponse(); res.setHeader('Vary', 'Accept-Encoding');
  setNodeCors(res, { Vary: 'Origin' }); setNodeCors(res, { Vary: 'Origin' });
  assert.equal(res.headers.vary, 'Accept-Encoding, Origin');
  let calls = 0;
  const guarded = withRequestSchema(requestSchemas.empty, () => { calls++; return Response.json({ ok: true }); });
  const response = await guarded(new Request('https://api.example.test/api/test', { headers: { Origin: allowed } })) as Response;
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), allowed);
  assert.equal(calls, 1);
});

test('local dev/production-preview accepts only the actual loopback listener without widening deployed APIs', () => {
  const origin = 'http://localhost:45981';
  const request = get('/api/test', { origin, host: 'outside.test' });
  assert.throws(() => corsHeaders(request));
  // Only the local adapter can establish socket context, not browser request headers.
  const local = { ...request, socket: { localAddress: '127.0.0.1', localPort: 45981 } };
  assert.throws(() => corsHeaders(local));
  markLocalCorsRequest(local);
  assert.equal(corsHeaders(local)['Access-Control-Allow-Origin'], origin);
  assert.throws(() => corsHeaders({ ...local })); // Context is scoped to the original request object.
  for (const [address, port] of [['192.0.2.1', 45981], ['127.0.0.1', 0], ['127.0.0.1', '45981']]) {
    const untrusted = { ...request, socket: { localAddress: address, localPort: port } };
    markLocalCorsRequest(untrusted);
    assert.throws(() => corsHeaders(untrusted));
  }
  local.headers.origin = 'http://localhost:45982';
  assert.throws(() => corsHeaders(local));
});
