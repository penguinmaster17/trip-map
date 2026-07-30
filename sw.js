/* Service worker for Trip Map.
 *
 * The point of this file is that the app opens without a connection. Your photo
 * library already lives in IndexedDB on the device, so once the code is cached
 * there is genuinely nothing left that needs the network — which matters when
 * you're abroad on airplane mode and want to look at where you've been.
 *
 * Bump CACHE_VERSION whenever index.html or cities.js changes, otherwise
 * returning visitors keep getting the old cached copy.
 */

const CACHE_VERSION = 'trip-map-v14';
const TILE_CACHE    = 'trip-map-tiles-v1';
const MAX_TILES     = 1200;  // a few cities' worth at the zooms you actually use;
                             // cached tiles are what make a second visit feel instant

// The app itself. cities.js is 1.2 MB, which is the bulk of it, but caching the
// place names is what lets trips still be labeled offline.
const APP_SHELL = [
  './',
  './index.html',
  './cities.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

// Third-party code, fetched from CDNs. Cached opportunistically — if any of
// these fail at install time the whole install would fail, so they're allowed
// to miss and get picked up on first use instead.
const VENDOR = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css',
  'https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js',
  'https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/full.umd.js'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await cache.addAll(APP_SHELL);                      // must all succeed
    await Promise.allSettled(VENDOR.map(u => cache.add(u)));  // may not
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = new Set([CACHE_VERSION, TILE_CACHE]);
    const names = await caches.keys();
    await Promise.all(names.filter(n => !keep.has(n)).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

const isTile = url =>
  url.hostname.endsWith('basemaps.cartocdn.com') || /\/\d+\/\d+\/\d+(@\dx)?\.png$/.test(url.pathname);

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Map tiles: serve from cache when present, otherwise fetch and keep a bounded
  // number so a long browsing session can't fill the device's storage.
  if (isTile(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(TILE_CACHE);
      const hit = await cache.match(request);
      if (hit) return hit;
      try {
        const res = await fetch(request);
        if (res.ok || res.type === 'opaque') {
          cache.put(request, res.clone());
          trimCache(TILE_CACHE, MAX_TILES);
        }
        return res;
      } catch (err) {
        return hit || Response.error();
      }
    })());
    return;
  }

  // Navigations: try the network so a fresh deploy is picked up, fall back to
  // the cached page when offline.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(request);
        const cache = await caches.open(CACHE_VERSION);
        cache.put('./index.html', res.clone());
        return res;
      } catch (err) {
        const cache = await caches.open(CACHE_VERSION);
        return (await cache.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  // Everything else — app files and vendor scripts — cache first. These are all
  // version-pinned, so a stale copy is the correct copy.
  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const res = await fetch(request);
      if (res.ok) {
        const cache = await caches.open(CACHE_VERSION);
        cache.put(request, res.clone());
      }
      return res;
    } catch (err) {
      return Response.error();
    }
  })());
});

async function trimCache(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length <= max) return;
  // Oldest first — cache.keys() preserves insertion order.
  await Promise.all(keys.slice(0, keys.length - max).map(k => cache.delete(k)));
}
