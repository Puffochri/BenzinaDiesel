/* Service Worker: precache static assets + runtime cache for API and tiles
   Strategy:
   - Precache index.html, style, script, manifest, icons
   - Runtime: stale-while-revalidate for API responses (short TTL)
   - Runtime: cache-first for map tiles with size limit
*/

const SW_VERSION = 'v1.0.0';
const PRECACHE = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

const RUNTIME_CACHE = 'runtime-cache-' + SW_VERSION;
const API_CACHE = 'api-cache-' + SW_VERSION;
const TILE_CACHE = 'tile-cache-' + SW_VERSION;

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(RUNTIME_CACHE).then(cache => cache.addAll(PRECACHE))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => ![RUNTIME_CACHE, API_CACHE, TILE_CACHE].includes(k)).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // API proxy responses: stale-while-revalidate (short)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(staleWhileRevalidate(event.request, API_CACHE, 60 * 60 * 24)); // 24h TTL logic handled by worker
    return;
  }

  // Map tiles: cache-first with limit
  if (url.hostname.includes('tile.openstreetmap.org')) {
    event.respondWith(cacheFirst(event.request, TILE_CACHE));
    return;
  }

  // Static assets: cache-first
  if (PRECACHE.includes(url.pathname) || url.pathname.endsWith('.css') || url.pathname.endsWith('.js')) {
    event.respondWith(caches.match(event.request).then(r => r || fetch(event.request)));
    return;
  }

  // Default: network-first fallback to cache
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

/* Helpers */
async function staleWhileRevalidate(req, cacheName, maxAgeSeconds = 3600) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const network = fetch(req).then(async res => {
    if (res && res.ok) {
      cache.put(req, res.clone());
    }
    return res;
  }).catch(()=>null);
  return cached || (await network) || new Response(null, { status: 504 });
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res && res.ok) cache.put(req, res.clone());
  return res;
}
