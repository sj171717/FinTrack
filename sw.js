const CACHE = "fintrack-v1";

// Core shell files to cache on install
const SHELL = [
  "/",
  "/index.html",
  "/manifest.json"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);

  // Never intercept API calls — always go live
  const isApi = url.hostname !== self.location.hostname ||
    url.pathname.startsWith("/api/") ||
    url.hostname.includes("finnhub") ||
    url.hostname.includes("firebase") ||
    url.hostname.includes("firestore") ||
    url.hostname.includes("googleapis") ||
    url.hostname.includes("stocktwits") ||
    url.hostname.includes("polygon") ||
    url.hostname.includes("financialdatasets") ||
    url.hostname.includes("kalshi") ||
    url.hostname.includes("fonts");

  if (isApi) return;

  // Cache-first for shell assets
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});
