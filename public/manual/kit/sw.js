/* Orbit Kit (PLAY-01) — offline cache for this page only.
   Living at manual/kit/sw.js gives it a natural scope of manual/kit/ (a
   service worker can never control a path above its own script), and the
   kit page registers it with that same scope explicitly. No other page on
   the station ever registers or is touched by this worker.

   It never reads or stores the URL fragment: the page's own model lives
   only in location.hash, which browsers never send over the network and
   which this file never looks at. It just caches whatever same-origin
   URLs the page tells it about (its own HTML, plus the JS/CSS/fonts the
   page reports loading), and serves those back when offline. */

const CACHE = 'orbit-kit-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(self.registration.scope))
      .catch(() => {
        /* A first install offline (nothing to fetch yet) shouldn't fail installation. */
      }),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/* The page posts the same-origin resource URLs it actually loaded (see
   kit.astro's postAssets()) once this worker is in control. */
self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'cache-urls' || !Array.isArray(event.data.urls)) return;
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        event.data.urls.map((url) =>
          fetch(url)
            .then((res) => (res && res.ok ? cache.put(url, res) : null))
            .catch(() => null),
        ),
      ),
    ),
  );
});

/* Cache-first within this worker's own scope, with opportunistic runtime
   caching of whatever else comes through (e.g. a re-fetch after an edit). */
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
          return res;
        })
        .catch(() => cached || Response.error());
    }),
  );
});
