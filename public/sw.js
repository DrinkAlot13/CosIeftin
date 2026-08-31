// CoșMic service worker — makes the shopping list usable IN STORE, where signal is worst.
//
// Strategy per request type:
//   • navigations  → network-first, fall back to cache, then the offline page.
//     (prices must be fresh when there IS signal; a stale list beats a dead page when there isn't)
//   • static assets → cache-first (they're content-hashed by Next).
//   • API/POST      → never cached; a stale basket total would be worse than an error.
//
// The list itself lives in localStorage, so it survives with or without this worker; the SW
// is what makes the PAGE that renders it load without a connection.

const VERSION = "cosmic-v1";
const STATIC_CACHE = `${VERSION}-static`;
const PAGE_CACHE = `${VERSION}-pages`;
const OFFLINE_URL = "/offline.html";

const PRECACHE = ["/", "/lista", OFFLINE_URL, "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PAGE_CACHE);
      // don't fail the whole install if one URL is unavailable
      await Promise.allSettled(PRECACHE.map((u) => cache.add(u)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // never cache mutations
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // let cross-origin go straight to network
  if (url.pathname.startsWith("/api/")) return; // prices/baskets must be live

  // Navigations: network-first so prices are current when online.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(PAGE_CACHE);
          cache.put(req, fresh.clone());
          return fresh;
        } catch {
          const cached = await caches.match(req);
          if (cached) return cached;
          const offline = await caches.match(OFFLINE_URL);
          return offline ?? new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
        }
      })(),
    );
    return;
  }

  // Static assets: cache-first (Next content-hashes them, so they're safe to keep).
  if (url.pathname.startsWith("/_next/static/") || /\.(css|js|woff2?|png|jpg|jpeg|svg|webp|ico)$/i.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        try {
          const fresh = await fetch(req);
          if (fresh.ok) {
            const cache = await caches.open(STATIC_CACHE);
            cache.put(req, fresh.clone());
          }
          return fresh;
        } catch {
          return new Response("", { status: 504 });
        }
      })(),
    );
  }
});
