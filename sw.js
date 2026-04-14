const CACHE = "fintrack-v4";

self.addEventListener("install", e => {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Never cache — always go to network
self.addEventListener("fetch", e => {
  e.respondWith(fetch(e.request));
});
