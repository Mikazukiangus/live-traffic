import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('early preferences use an external blocking script and only fixed DOM values', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('<script src="/theme-init.js"></script>') < html.indexOf('<body'));
  assert.doesNotMatch(html, /<script\b(?![^>]*\bsrc=)[^>]*>/i);
  const bootstrap = await readFile(new URL('../public/theme-init.js', import.meta.url), 'utf8');
  for (const [theme, text, expected] of [['dark', 'large', { theme: 'dark', text: 'large' }],
    ['light', null, { theme: 'light' }], ['<img>', '<img>', {}], [null, null, {}]] as const) {
    const dataset = {};
    runInNewContext(bootstrap, { document: { documentElement: { dataset } }, localStorage: {
      getItem: (key: string) => key.endsWith('.theme') ? theme : text,
    } });
    assert.deepEqual(dataset, expected);
  }
  assert.doesNotThrow(() => runInNewContext(bootstrap, { localStorage: { getItem: () => { throw new Error('Blocked'); } } }));
});

test('service worker precaches the bootstrap and serves it offline without renewing API data ages', async () => {
  const handlers: Record<string, (event: any) => void> = {};
  const saved = new Map<string, Response>();
  const precached: string[] = [];
  const store = (r: Request | string) => typeof r === 'string' ? new URL(r, 'https://traffic.test').href : r.url;
  let online = true;
  const context = { URL, Headers, Response, Date,
    self: { location: { origin: 'https://traffic.test' }, skipWaiting() {}, addEventListener: (name: string, handler: any) => { handlers[name] = handler; } },
    caches: { open: async () => ({ addAll: async (urls: string[]) => {
      precached.push(...urls); urls.forEach((url) => saved.set(store(url), new Response('preloaded bootstrap')));
    }, put: async (r: Request | string, response: Response) => { saved.set(store(r), response); } }),
    match: async (r: Request | string) => saved.get(store(r))?.clone() },
    fetch: async () => { if (!online) throw new Error('Offline'); return new Response('fresh bootstrap'); },
  };
  runInNewContext(await readFile(new URL('../public/sw.js', import.meta.url), 'utf8'), context);
  let installed!: Promise<void>;
  handlers.install({ waitUntil: (p: Promise<void>) => { installed = p; } });
  await installed;
  assert.ok(precached.includes('/theme-init.js'));
  const load = () => {
    let pending!: Promise<Response>;
    handlers.fetch({ request: new Request('https://traffic.test/theme-init.js'), respondWith: (p: Promise<Response>) => { pending = p; } });
    return pending;
  };
  assert.equal(await (await load()).text(), 'fresh bootstrap');
  online = false;
  const offline = await load();
  assert.equal(await offline.text(), 'fresh bootstrap');
  assert.equal(offline.headers.get('X-TrafficPulse-Cached-At'), null);
});
