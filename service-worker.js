/* Vigil PWA service worker — Phase 0 (app-shell caching only).
 *
 * Scope: caches the app shell so Vigil LOADS offline. It does NOT cache API
 * responses or handle offline writes — that is Phase 1/2. Deliberately
 * conservative so a bad cache can't strand users:
 *   - /api/* and any non-GET request: network only, never cached.
 *   - same-origin GET assets: stale-while-revalidate (serve cache instantly,
 *     refresh in the background) so updates always land within one reload.
 *   - Google Fonts: cache-first (immutable, versioned URLs).
 *   - a failed navigation with nothing cached falls back to /offline.html.
 * Bump CACHE to invalidate everything; old caches are deleted on activate.
 */
const CACHE = 'vigil-shell-v1';
const PRECACHE = [
  '/vigil-demo.html',
  '/vigil-auth.js',
  '/vigil-module.css',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/offline.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Kill switch: a page can post {type:'UNREGISTER'} to disable the SW.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'UNREGISTER') {
    self.registration.unregister().then(() => self.clients.claim());
  }
});

const isFont = (url) => url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Never touch API traffic or non-GET requests — always straight to network.
  if (req.method !== 'GET' || url.pathname.startsWith('/api/') || url.pathname === '/health') {
    return; // default browser handling (network)
  }

  // Google Fonts: cache-first (immutable).
  if (isFont(url)) {
    event.respondWith(
      caches.open(CACHE).then((cache) =>
        cache.match(req).then((hit) =>
          hit || fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; })
            .catch(() => hit)
        )
      )
    );
    return;
  }

  // Same-origin GET: stale-while-revalidate.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.open(CACHE).then((cache) =>
        cache.match(req).then((cached) => {
          const network = fetch(req)
            .then((res) => { if (res.ok && res.type === 'basic') cache.put(req, res.clone()); return res; })
            .catch(() => null);
          // Serve cache immediately if present; otherwise wait for the network.
          return cached || network.then((res) => res || fallback(req));
        })
      )
    );
    return;
  }
  // Other cross-origin GETs: leave to the browser.
});

function fallback(req) {
  // Only navigations get the offline page; other misses just error out.
  if (req.mode === 'navigate') return caches.match('/offline.html');
  return new Response('', { status: 504, statusText: 'Offline' });
}
