const SW_VER = 'sw-v1.4';
const PRECACHE = [
  '/', '/index.html', '/style.css', '/script.js', '/manifest.webmanifest',
  '/icons/icon-192.png', '/icons/icon-512.png'
];
const RUNTIME = 'runtime-' + SW_VER;
const API_CACHE = 'api-' + SW_VER;
const TILE_CACHE = 'tiles-' + SW_VER;

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(RUNTIME).then(c => c.addAll(PRECACHE)));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => ![RUNTIME, API_CACHE, TILE_CACHE].includes(k)).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(staleWhileRevalidate(event.request, API_CACHE));
    return;
  }

  if (url.hostname.includes('tile.openstreetmap.org')) {
    event.respondWith(cacheFirst(event.request, TILE_CACHE));
    return;
  }

  if (PRECACHE.includes(url.pathname) || url.pathname.endsWith('.css') || url.pathname.endsWith('.js')) {
    event.respondWith(caches.match(event.request).then(r => r || fetch(event.request)));
    return;
  }

  event.respondWith(fetch(event.request).catch(()=>caches.match(event.request)));
});

async function staleWhileRevalidate(req, cacheName){
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const network = fetch(req).then(res => { if (res && res.ok) cache.put(req, res.clone()); return res; }).catch(()=>null);
  return cached || (await network) || new Response(null, { status: 504 });
}

async function cacheFirst(req, cacheName){
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res && res.ok) cache.put(req, res.clone());
  return res;
}
