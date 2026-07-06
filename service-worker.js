/* Vigil PWA service worker.
 *
 * Phase 0: caches the app shell so Vigil LOADS offline.
 * Phase 1: network-first caching of safety-read API GETs so pages show their
 *          last-seen data with no signal (fresh whenever online).
 * Still deliberately conservative so a bad cache can't strand users:
 *   - non-GET and /api/auth/*: network only, never cached.
 *   - GET /api/* (non-auth): network-FIRST, cached as a fallback for offline.
 *   - same-origin GET assets: stale-while-revalidate (cache instantly, refresh
 *     in the background) so updates land within one reload.
 *   - Google Fonts: cache-first (immutable). Failed navigation → /offline.html.
 * Bump CACHE / API_CACHE to invalidate; old caches are deleted on activate.
 */
const CACHE = 'vigil-shell-v9';
const API_CACHE = 'vigil-api-v1';
const KEEP = [CACHE, API_CACHE];
const PRECACHE = [
  '/vigil-demo.html',
  '/vigil-auth.js',
  '/vigil-offline.js',
  '/vigil-module.css',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/offline.html',
  // Core field pages precached so they load offline before their first visit.
  '/vigil-emergency.html',
  '/vigil-permit-to-work.html',
  '/vigil-hazard-assessment.html',
  '/vigil-incident-reporting.html',
  '/vigil-observations.html',
  '/vigil-inspections.html',
  '/vigil-documents.html',
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
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
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

  // Non-GET, /health, and auth: always straight to network (never cached).
  if (req.method !== 'GET' || url.pathname === '/health' || url.pathname.startsWith('/api/auth')) {
    return;
  }

  // Safety-read API GETs: network-first, fall back to the last cached copy.
  // Online users always get fresh data; offline users get what they last saw.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) { const clone = res.clone(); caches.open(API_CACHE).then((c) => c.put(req, clone)); }
          return res;
        })
        .catch(() => caches.open(API_CACHE).then((c) => c.match(req)).then((hit) =>
          hit || new Response(JSON.stringify({ error: 'offline', offline: true }), { status: 503, headers: { 'Content-Type': 'application/json' } })
        ))
    );
    return;
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

  // Same-origin GET assets: stale-while-revalidate.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.open(CACHE).then((cache) =>
        cache.match(req).then((cached) => {
          const network = fetch(req)
            .then((res) => { if (res.ok && res.type === 'basic') cache.put(req, res.clone()); return res; })
            .catch(() => null);
          return cached || network.then((res) => res || fallback(req));
        })
      )
    );
    return;
  }
  // Other cross-origin GETs: leave to the browser.
});

function fallback(req) {
  if (req.mode === 'navigate') return caches.match('/offline.html');
  return new Response('', { status: 504, statusText: 'Offline' });
}
