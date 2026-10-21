import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createConfig, createPublicConfig } from '../config/schema.ts';
import { escapeHtmlAttribute, renderSiteMetadata } from '../server/html/metadata.ts';

test('canonical site hosts reject HTML delimiters, malformed DNS and normalization tricks', () => {
  for (const site of [
    'https://private-marker.test"onfocus="alert(1)', 'https://private-marker.test\'event',
    'https://private-marker.test&event', 'https://private-marker.test$event',
    'https://private-marker.test/\\other', 'https://private-marker.test\tonfocus',
    'https://private-marker..test', 'https://-private-marker.test', 'https://private-marker-.test',
    'https://' + 'a'.repeat(64) + '.private-marker.test', 'https://private_marker.test',
    'https://private-marker.test/subpath', 'https://user:private-marker@example.test',
  ]) {
    for (const parse of [createConfig, createPublicConfig]) assert.throws(() => parse({ VITE_SITE_URL: site }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /VITE_SITE_URL/);
      assert.ok(!error.message.includes('private-marker'));
      return true;
    });
  }
  for (const site of ['https://example.test', 'https://example.test:8443', 'https://localhost', 'https://127.0.0.1',
    'https://[::1]', 'https://example.test.', 'https://xn--bcher-kva.example']) {
    assert.equal(createConfig({ VITE_SITE_URL: site }).siteUrl, site);
    assert.equal(createPublicConfig({ VITE_SITE_URL: site }).siteUrl, site);
  }
  assert.equal(createConfig({ NODE_ENV: 'test', VITE_SITE_URL: 'http://localhost:4500' }).siteUrl, 'http://localhost:4500');
});

test('HTML serialization encodes only the attribute context and preserves literal replacement tokens', async () => {
  const value = `https://example.test/"'<tag>&$&$\`$'`;
  assert.equal(escapeHtmlAttribute(value), 'https://example.test/&quot;&#39;&lt;tag&gt;&amp;$&amp;$`$&#39;');
  const template = '<meta content="__TRAFFICPULSE_SITE_URL__/"><meta content="__TRAFFICPULSE_SITE_URL__/og-image.png">';
  const html = renderSiteMetadata(template, value);
  assert.equal(html, `<meta content="${escapeHtmlAttribute(value)}/"><meta content="${escapeHtmlAttribute(value)}/og-image.png">`);
  assert.equal((html.match(/"/g) || []).length, 4);
  assert.ok(!html.includes('<tag>'));
  assert.ok(!html.includes('__TRAFFICPULSE_SITE_URL__'));
  const actual = renderSiteMetadata(await readFile(new URL('../index.html', import.meta.url), 'utf8'), 'https://example.test');
  assert.ok(actual.includes('content="https://example.test/og-image.png"'));
});

test('notification data cannot choose navigation in either existing-window or new-window branches', async () => {
  const worker = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  for (const existing of [false, true]) {
    const handlers: Record<string, (event: any) => void> = {};
    const navigations: string[] = [];
    let focused = 0, closed = 0, dataRead = 0;
    const own = { url: 'https://traffic.test/?page=cameras', focus: async () => { focused++; return own; },
      navigate: async (url: string) => { navigations.push(url); } };
    const foreign = { url: 'https://outside.test/', focus: () => { throw new Error('Wrong window'); } };
    runInNewContext(worker, { URL, self: {
      location: { origin: 'https://traffic.test' },
      addEventListener: (name: string, handler: (event: any) => void) => { handlers[name] = handler; },
      clients: { matchAll: async () => existing ? [foreign, own] : [foreign],
        openWindow: async (url: string) => { assert.ok(!existing); navigations.push(url); } },
    } });
    for (const supplied of [undefined, '/', 'https://outside.test/', '//outside.test/', 'javascript:alert(1)',
      'data:text/html,fixture', 'https://user:pass@outside.test/', '%%%']) {
      let done!: Promise<unknown>;
      handlers.notificationclick({ notification: { close: () => { closed++; },
        get data() { dataRead++; return { url: supplied }; } }, waitUntil: (promise: Promise<unknown>) => { done = promise; } });
      await done;
    }
    assert.equal(closed, 8);
    assert.equal(dataRead, 0);
    assert.equal(focused, existing ? 8 : 0);
    assert.deepEqual(navigations, Array(8).fill('https://traffic.test/?page=radar&tab=incidents'));
  }
});
