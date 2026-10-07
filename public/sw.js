/*
 * TrafficPulse service worker: lets the installed app open with no signal and show the last
 * live data it received. Pages and /api data are network-first (always fresh when online);
 * hashed build assets are cache-first. The app flags old data itself from each feed's timestamp.
 */
const VERSION = 'v1';
const SHELL = `shell-${VERSION}`;
const ASSETS = `assets-${VERSION}`;
const DATA = `data-${VERSION}`;
const FONTS = `fonts-${VERSION}`;
const KEEP = [SHELL, ASSETS, DATA, FONTS];

// Never cached: camera photos (large, only useful live), the vehicle-count model and its 14 MB
// runtime (the browser's HTTP cache keeps those), and the health check.
const BYPASS = [/^\/api\/imageproxy/, /^\/api\/health/, /^\/models\//, /\.wasm$/];
// Each deploy adds new hashed assets; keep only the newest ones.
const MAX_ASSETS = 40;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icons/icon-192.png'])));
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

async function networkFirst(request, cacheName, fallbackUrl) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(fallbackUrl || request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(fallbackUrl || request);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
    if (cacheName === ASSETS) {
      const keys = await cache.keys();
      await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ASSETS)).map((k) => cache.delete(k)));
    }
  }
  return response;
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
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, ASSETS));
  } else if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request, DATA));
  }
});
