// SwingLab service worker: network-first for app code (so deploys land
// immediately), cache-fallback for offline, cache-first for the big immutable
// ML assets so repeat visits skip the 28MB download.
const CACHE = 'swinglab-v2';
const IMMUTABLE = /\/vendor\/|\/assets\//;

self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  // Drop every cache from older versions so installed PWAs can't serve a
  // stale mix of old and new app code after an update.
  for (const key of await caches.keys()) {
    if (key !== CACHE) await caches.delete(key);
  }
  await clients.claim();
})()));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  if (IMMUTABLE.test(url.pathname)) {
    // cache-first: model/wasm/art never change without a filename change
    e.respondWith(
      caches.open(CACHE).then(async c => {
        const hit = await c.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok) c.put(e.request, res.clone());
        return res;
      })
    );
  } else {
    // network-first: always fresh app code, cached copy when offline
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
  }
});
