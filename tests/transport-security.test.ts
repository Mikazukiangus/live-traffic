import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createConfig, createPublicConfig } from '../config/schema.ts';
import { fetchProvider } from '../server/http/providerFetch.ts';
import { transportNotice, installTransportDiagnostics } from '../src/utils/transportSecurity.ts';
import { auditProjectTransport, auditTransportSource } from '../scripts/transport-audit.ts';

test('production/deployment URL settings require HTTPS while local tests retain explicit loopback support', () => {
  for (const key of [
    'LTA_BASE_URL',
    'DATA_GOV_BASE_URL',
    'VITE_SITE_URL',
    'VITE_TRAFFIC_IMAGES_URL',
    'OVERPASS_API_URL',
  ]) {
    for (const env of [{ NODE_ENV: 'production' }, { NODE_ENV: 'development', VERCEL: '1' }]) {
      assert.throws(
        () => createConfig({ ...env, [key]: 'http://127.0.0.1/private-marker' }),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.ok(error.message.includes(key));
          assert.ok(!error.message.includes('private-marker'));
          return true;
        },
      );
    }
  }
  for (const NODE_ENV of ['development', 'test'])
    assert.equal(
      createConfig({ NODE_ENV, LTA_BASE_URL: 'http://localhost:4500/lta' }).server.upstreams.ltaBase,
      'http://localhost:4500/lta',
    );
  assert.equal(createConfig({ NODE_ENV: 'test' }).server.allowLoopbackHttp, true);
  assert.equal(createConfig({ NODE_ENV: 'development', VERCEL: '1' }).server.allowLoopbackHttp, false);
  assert.equal(createConfig({ NODE_ENV: 'development', VERCEL_ENV: 'preview' }).server.allowLoopbackHttp, false);
  assert.equal(createConfig().server.allowLoopbackHttp, false);
  assert.throws(
    () => createConfig({ NODE_ENV: 'test', PRODUCTION_HEALTH_URL: 'http://localhost:4500/api/health' }),
    /PRODUCTION_HEALTH_URL/,
  );
  assert.ok(createConfig({ VITE_SITE_URL: 'https://example.test' }));
});

test('public build/preview projections reject HTTP fallbacks and origins without leaking rejected values', () => {
  for (const flags of [{ PROD: true }, { NODE_ENV: 'production' }, { VITE_VERCEL_ENV: 'preview' }]) {
    for (const key of ['VITE_SITE_URL', 'VITE_TRAFFIC_IMAGES_URL'])
      assert.throws(() => createPublicConfig({ ...flags, [key]: 'http://localhost:4500' }), new RegExp(key));
  }
  assert.equal(
    createPublicConfig({ PROD: false, VITE_SITE_URL: 'http://localhost:4500' }).siteUrl,
    'http://localhost:4500',
  );
});

test('provider transport rejects insecure/credential URLs before sending anything and forces no redirects', async () => {
  let calls = 0;
  let recorded: unknown;
  const transport = (async (url, init) => {
    calls++;
    recorded = { url, init };
    return Response.json({ ok: true });
  }) as typeof fetch;
  for (const input of [
    'http://example.test/private-marker',
    'http://localhost:4500/private-marker',
    'ftp://example.test',
    'https://user:private-marker@example.test',
    'invalid-private-marker',
  ]) {
    assert.throws(
      () => fetchProvider(input, { headers: { AccountKey: 'synthetic-key' } }, transport),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(!error.message.includes('private-marker'));
        return true;
      },
    );
  }
  assert.equal(calls, 0);
  const url = 'https://images.example.test/photo.jpg?signature=synthetic%2Bvalue%2fexact';
  const headers = { AccountKey: 'synthetic-key' };
  await fetchProvider(url, { headers, redirect: 'follow' }, transport);
  assert.deepEqual(recorded, { url, init: { headers, redirect: 'error' } });
  assert.equal(calls, 1);
});

test('all deployed routes have HSTS and an HTTPS-only resource policy compatible with fonts and WASM workers', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  const rule = config.headers.find((r: any) => r.source === '/(.*)');
  assert.ok(rule, 'the policy must cover HTML, APIs, assets, worker files and errors');
  const headers = Object.fromEntries(rule.headers.map((h: any) => [h.key.toLowerCase(), h.value]));
  assert.match(headers['strict-transport-security'], /max-age=63072000/);
  assert.match(headers['strict-transport-security'], /includeSubDomains/);
  const policy = new Map<string, string[]>(
    headers['content-security-policy'].split(';').map((directive: string) => {
      const [name, ...values] = directive.trim().split(/\s+/);
      return [name, values];
    }),
  );
  assert.ok(policy.has('upgrade-insecure-requests'));
  for (const directive of ['default-src', 'style-src', 'connect-src']) {
    assert.ok(policy.get(directive)?.includes('https:'));
    for (const bad of ['http:', 'ws:', '*']) assert.ok(!policy.get(directive)?.includes(bad));
  }
  assert.ok(policy.get('script-src')?.includes("'wasm-unsafe-eval'"));
  assert.deepEqual(policy.get('script-src'), ["'self'", "'wasm-unsafe-eval'"]);
  assert.deepEqual(policy.get('script-src-attr'), ["'none'"]);
  assert.deepEqual(policy.get('worker-src'), ["'self'", 'blob:']);
  assert.equal(headers['x-content-type-options'], 'nosniff');
});

test('source gate flags insecure URLs and new cookie paths without echoing resource values', () => {
  for (const [file, source] of [
    ['src/Image.tsx', '<img src="http://example.test/photo?signature=private-marker"/>'],
    ['src/app.ts', "fetch('ws://example.test/private-marker')"],
    ['src/a.css', 'body{background:url(//example.test/private-marker)}'],
    [
      'public/a.svg',
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="http://example.test/private-marker"/></svg>',
    ],
    ['src/a.ts', String.raw`fetch('http:\/\/example.test/private-marker')`],
    ['src/a.ts', String.raw`fetch('\u0068ttp://example.test/private-marker')`],
  ]) {
    const result = auditTransportSource(file, source);
    assert.equal(result[0]?.code, 'INSECURE_URL');
    assert.ok(!JSON.stringify(result).includes('private-marker'));
  }
  for (const source of [
    'document.cookie = "private-marker"',
    'document["cookie"] = "private-marker"',
    "res.setHeader('Set-Cookie', 'private-marker')",
    'cookieStore.set("private-marker", "value")',
    'res.cookie("session", "private-marker")',
    'cookies().set("session", "private-marker")',
    "import Cookies from 'js-cookie'",
  ])
    assert.equal(auditTransportSource('src/a.ts', source)[0]?.code, 'COOKIE_POLICY_REVIEW');
  assert.deepEqual(auditTransportSource('public/icon.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>'), []);
  assert.deepEqual(
    auditTransportSource('src/a.ts', "fetch('/api/traffic'); const a='https://example.test/image.jpg'"),
    [],
  );
});

test('mixed-content notices redact URLs, use fixed classifications and stop reporting after disposal', () => {
  const raw = {
    blockedURI: 'http://example.test/photo?signature=private-marker',
    effectiveDirective: 'img-src',
  };
  assert.deepEqual(transportNotice(raw), {
    event: 'transport_policy_violation',
    code: 'INSECURE_RESOURCE',
    scheme: 'http',
    directive: 'img-src',
  });
  assert.equal(transportNotice({ ...raw, blockedURI: 'https://example.test/photo' }), null);
  assert.equal(transportNotice({ ...raw, blockedURI: 'blob:fixture' }), null);
  const notice = transportNotice({
    blockedURI: 'ws://example.test/private-marker',
    effectiveDirective: 'private-marker',
  });
  assert.equal(notice?.directive, 'resource');
  assert.ok(!JSON.stringify(notice).includes('private-marker'));
  const target = new EventTarget();
  const reports: unknown[] = [];
  const stop = installTransportDiagnostics(target, (value) => reports.push(value));
  const emit = () => target.dispatchEvent(Object.assign(new Event('securitypolicyviolation'), raw));
  emit();
  emit();
  assert.equal(reports.length, 1);
  stop();
  emit();
  assert.equal(reports.length, 1);
});

test('current runtime sources contain no insecure URL literals or application cookie writers', async () => {
  assert.deepEqual(await auditProjectTransport(path.resolve(import.meta.dirname, '..')), []);
});
