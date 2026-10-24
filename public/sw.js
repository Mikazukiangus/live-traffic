/*
 * TrafficPulse service worker: lets the installed app open with no signal and show the last
 * live data it received. Pages and /api data are network-first (always fresh when online);
 * hashed build assets are cache-first. The app flags old data itself from each feed's timestamp.
 */
const VERSION = 'v5';
// Refresh cached HTML so offline navigation also receives the deployed security policy.
// Preserve existing data/font/asset caches and their original observation timestamps.
const SHELL = 'shell-v7';
const ASSETS = `assets-${VERSION}`;
const DATA = `data-${VERSION}`;
const FONTS = `fonts-${VERSION}`;
const KEEP = [SHELL, ASSETS, DATA, FONTS];
// Replaced at build time from validated public configuration; never fetch config to start the worker.
const NETWORK_TIMEOUTS = '__TRAFFICPULSE_NETWORK_TIMEOUTS__';

// Never cached: camera photos (large, only useful live), the vehicle-count model and its 14 MB
// runtime (the browser's HTTP cache keeps those), and the health check.
const BYPASS = [/^\/api\/imageproxy/, /^\/api\/health/, /^\/models\//, /\.wasm$/];
// Each deploy adds new hashed assets; keep only the newest ones.
const MAX_ASSETS = 40;

// One worker serves several tabs. Serialize compare-and-put per cache key so a slow,
// older request cannot overwrite a newer successful response (or renew its cached age).
const cacheUpdates = new Map();
function cacheRequest(request, cacheName, fallbackUrl) {
  const target = fallbackUrl || request;
  const url = new URL(typeof target === 'string' ? target : target.url, self.location.origin).href;
  const key = `${cacheName}:${url}`;
  let state = cacheUpdates.get(key);
  if (!state) {
    state = { issued: 0, committed: 0, active: 0, writes: 0, tail: Promise.resolve() };
    cacheUpdates.set(key, state);
  }
  const version = ++state.issued;
  state.active++;
  const clean = () => {
    if (!state.active && !state.writes && cacheUpdates.get(key) === state) cacheUpdates.delete(key);
  };
  return {
    async put(response, signal) {
      state.writes++;
      const write = state.tail.then(async () => {
        if (version < state.committed || signal?.aborted) return;
        const cache = await caches.open(cacheName);
        let saved = response.clone();
        if (cacheName === DATA) {
          const headers = new Headers(saved.headers);
          headers.set('X-TrafficPulse-Cached-At', String(Date.now()));
          saved = new Response(await saved.blob(), { status: saved.status, headers });
        }
        if (signal?.aborted) return;
        await cache.put(target, saved);
        // Failed writes never supersede the last usable cached response.
        state.committed = version;
      });
      state.tail = write.catch(() => {});
      try { await write; } finally { state.writes--; clean(); }
    },
    release() { state.active--; clean(); },
  };
}

self.addEventListener('install', (event) => {
  event.waitUntil(Promise.all(['/', '/theme-init.js', '/manifest.webmanifest', '/icons/icon-192.png'].map(async (path) => {
    const request = new Request(new URL(path, self.location.origin));
    const response = await boundedFetch(request, NETWORK_TIMEOUTS.assets);
    if (!response.ok) throw new Error('Offline shell unavailable');
    const cache = await caches.open(SHELL);
    await cache.put(path, response);
  })));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function boundedFetch(request, timeoutMs, consume = async (response) => response) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeoutMs);
  const signal = AbortSignal.any([request.signal, controller.signal]);
  let rejectAbort;
  const aborted = new Promise((_, reject) => {
    rejectAbort = () => reject(signal.reason);
    signal.addEventListener('abort', rejectAbort, { once: true });
    if (signal.aborted) rejectAbort();
  });
  try {
    return await Promise.race([(async () => {
      signal.throwIfAborted();
      const response = await fetch(request, { signal });
      // Reading a clone preserves response type, headers and navigation behavior.
      await response.clone().blob();
      signal.throwIfAborted();
      return consume(response, signal);
    })(), aborted]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', rejectAbort);
  }
}

function dataTimeout(request) {
  const fullBudget = new URL(request.url).pathname === '/api/expresswayspeeds'
    ? NETWORK_TIMEOUTS.speeds : NETWORK_TIMEOUTS.request;
  // Let a cached fallback reach the page before its own deadline expires.
  return Math.max(1, Math.floor(fullBudget * 0.8));
}

async function networkFirst(request, cacheName, fallbackUrl) {
  const update = cacheRequest(request, cacheName, fallbackUrl);
  try {
    const response = await boundedFetch(request, cacheName === DATA ? dataTimeout(request) : NETWORK_TIMEOUTS.request);
    if (response.ok) {
      try {
        await update.put(response, request.signal);
      } catch {
        // Storage full or disabled: the successful network answer is still usable.
      }
    }
    return response;
  } catch (err) {
    if (request.signal.aborted) throw err;
    const cached = await caches.match(fallbackUrl || request);
    if (cached) {
      if (cacheName !== DATA) return cached;
      const headers = new Headers(cached.headers);
      headers.set('X-TrafficPulse-Offline', '1');
      return new Response(await cached.blob(), { status: cached.status, headers });
    }
    throw err;
  } finally {
    update.release();
  }
}

async function cacheFirst(request, cacheName) {
  const update = cacheRequest(request, cacheName);
  try {
    const cached = await caches.match(request);
    if (cached) return cached;
    return await boundedFetch(request, cacheName === FONTS ? NETWORK_TIMEOUTS.request : NETWORK_TIMEOUTS.assets, async (response, signal) => {
      // Keep cancellation live through cache.put too: opaque font bodies cannot be read by JS.
      if (response.ok || response.type === 'opaque') {
        const cache = await caches.open(cacheName);
        await update.put(response, signal);
        if (cacheName === ASSETS) {
          const keys = await cache.keys();
          await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ASSETS)).map((k) => cache.delete(k)));
        }
      }
      return response;
    });
  } finally { update.release(); }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    // Google Fonts (stylesheets and font files), so the app looks right offline.
    if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
      event.respondWith(cacheFirst(request, FONTS));
    }
    return;
  }
  if (BYPASS.some((re) => re.test(url.pathname))) return;

  if (request.mode === 'navigate') {
    // Every page is the same app shell; ?page=… is read by the app.
    event.respondWith(networkFirst(request, SHELL, '/'));
  } else if (url.pathname === '/theme-init.js') {
    // The early preference script must be available with the offline HTML shell.
    event.respondWith(networkFirst(request, SHELL));
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, ASSETS));
  } else if (url.pathname.startsWith('/api/')) {
    // Session/account responses and cookies must never enter the offline public-feed cache.
    if (url.pathname.startsWith('/api/auth/') || url.searchParams.getAll('feed').includes('auth')) {
      event.respondWith(boundedFetch(request, NETWORK_TIMEOUTS.request));
      return;
    }
    // Traversal must check the current snapshot. Never persist per-page/token URLs or
    // turn a stale offline page into a successful continuation of a live list.
    if (['limit', 'offset', 'collection', 'snapshot'].some((key) => url.searchParams.has(key))) {
      event.respondWith(boundedFetch(request, url.pathname === '/api/expresswayspeeds'
        ? NETWORK_TIMEOUTS.speeds : NETWORK_TIMEOUTS.request));
    } else event.respondWith(networkFirst(request, DATA));
  }
});

// Commute alerts: tapping one opens (or focuses) the app on the Incidents tab.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // All current notifications concern incidents. Never navigate from notification-supplied data.
  const url = new URL('/?page=radar&tab=incidents', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => new URL(w.url).origin === self.location.origin);
      if (win) return win.focus().then((w) => w.navigate(url));
      return self.clients.openWindow(url);
    })
  );
});
