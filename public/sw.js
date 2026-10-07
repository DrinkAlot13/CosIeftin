// CosIeftin service worker — makes the shopping list usable IN STORE, where signal is worst.
//
// v2. The first version rendered "Ești offline" on every page WHILE THE BROWSER WAS ONLINE,
// persistently, on the dev origin. Three defects stacked:
//
//   1. It treated "this fetch failed" and "we are offline" as the same fact. They are not: a
//      dev server that died or moved ports, and a cache.put that threw, both landed in the same
//      catch and rendered the offline page to an online browser. The fifteenth instance of the
//      project's recurring shape — two kinds of fact in one representation.
//   2. `cache.put` sat INSIDE the same try as the fetch, so a failure to CACHE a good response
//      discarded that response and served the fallback instead.
//   3. It was registered in development, where asset hashes change on every rebuild, so a stale
//      worker could sit on the origin forever. Registration is now production-only, and dev
//      actively unregisters (see ServiceWorker.tsx).
//
// Strategy per request type (unchanged in intent):
//   • navigations  → network-first; cached page, then offline page, ONLY when actually offline.
//   • static assets → cache-first (they're content-hashed by Next).
//   • API/POST      → never cached; a stale basket total would be worse than an error.
//
// v4 adds push notifications — "a favourite just dropped", sent from scripts/notify-push.ts.
// The payload is plain JSON (title/body/url); this worker's only job is to show it and open the
// right page on click. No new caching behaviour.

const VERSION = "cosmic-v4";
const STATIC_CACHE = `${VERSION}-static`;
const PAGE_CACHE = `${VERSION}-pages`;
const OFFLINE_URL = "/offline.html";

// v3 adds the in-shop screen. It is the ONE route that must open with the radio off — a person
// standing in an aisle who gets the offline page instead of their list has been failed at the
// only moment this app exists for. Its data comes from `cosmic_basket_cache_v1` in localStorage,
// which the worker does not touch; precaching the SHELL is what makes the route reachable.
const PRECACHE = [
  "/",
  "/lista",
  "/lista/in-magazin",
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icon.svg",
  "/icons/icon-192.png",
  "/icons/apple-touch-icon.png",
];

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

/** Cache a response without ever letting the attempt break the response itself. */
function putSafely(cacheName, req, res) {
  return caches
    .open(cacheName)
    .then((cache) => cache.put(req, res))
    .catch(() => {
      /* a response we failed to CACHE is still a response we can SERVE */
    });
}

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
        let fresh;
        try {
          fresh = await fetch(req);
        } catch (err) {
          // THE DISTINCTION THE FIRST VERSION MISSED. A failed fetch while the browser says it
          // is ONLINE is a server problem, not an offline shopper — showing "Ești offline"
          // there is a lie the user cannot debug. Surface the truth instead, and log it: this
          // path executing while online IS the bug this rewrite fixed, and it must be loud if
          // it ever happens again.
          if (self.navigator.onLine) {
            console.error("[sw] navigation fetch failed while ONLINE — server unreachable, NOT offline:", String(err));
            // NAME THE ACTUAL CAUSE, and on localhost name the fix. A dead dev server has
            // misdiagnosed this project five times — the ChunkLoadError, two "old copy still
            // rendering" confusions, the smoke-test noise, and the report that produced this
            // rewrite. Every one of those cost a diagnosis because the page on screen said
            // something other than what was wrong.
            const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(self.location.hostname);
            const hint = isLocal
              ? "<p><b>Serverul de dezvoltare nu rulează.</b> Pornește-l cu " +
                "<code style=\"background:#eee;padding:2px 6px;border-radius:4px\">npm run dev</code> " +
                "și reîncarcă pagina.</p>"
              : "<p>Reîncearcă în câteva secunde.</p>";
            // THE WORKER REPORTS ITSELF IN THE ARTIFACT, not only to a console.
            //
            // `console.error` from a service worker goes to the WORKER's context, not the
            // page's — invisible to anything watching page console events, and easy to miss in
            // DevTools too. This path executing while online is a real fault, so it is stamped
            // into the response it returns: machine-readable, survives being screenshotted, and
            // testable without depending on where a console message happens to land.
            return new Response(
              "<!doctype html><meta charset=utf-8><title>Serverul nu răspunde</title>" +
                "<meta name=\"sw-diagnostic\" content=\"server-down-while-online\">" +
                "<body style=\"font-family:system-ui;padding:40px;max-width:36em;margin:auto;line-height:1.55\">" +
                "<h1>Serverul nu răspunde</h1>" +
                "<p>Ești <b>online</b> — conexiunea ta funcționează. Serverul CosIeftin nu a răspuns.</p>" +
                hint +
                "</body>",
              { status: 502, headers: { "Content-Type": "text/html; charset=utf-8", "X-SW-Diagnostic": "server-down-while-online" } },
            );
          }
          const cached = await caches.match(req);
          if (cached) return cached;
          const offline = await caches.match(OFFLINE_URL);
          return offline ?? new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
        }
        // Caching is an optimisation, never the difference between a page and the fallback.
        event.waitUntil(putSafely(PAGE_CACHE, req, fresh.clone()));
        return fresh;
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
          if (fresh.ok) event.waitUntil(putSafely(STATIC_CACHE, req, fresh.clone()));
          return fresh;
        } catch {
          return new Response("", { status: 504 });
        }
      })(),
    );
  }
});

// ── PUSH NOTIFICATIONS ──────────────────────────────────────────────────────────────────────
//
// The payload is plain JSON, not the Push API's binary form — `event.data.json()` handles that.
// A malformed or missing payload must not throw inside the handler (an uncaught error here
// kills the whole event, not just the notification), so it falls back to a generic message
// rather than showing nothing.
self.addEventListener("push", (event) => {
  let data = { title: "CosIeftin", body: "Ai o actualizare.", url: "/" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    /* keep the fallback rather than show nothing */
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: data.url },
    }),
  );
});

// Clicking the notification focuses an already-open tab on the right page rather than always
// opening a new one — a shopper who already has the site open should not end up with two tabs.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clientsList) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    })(),
  );
});
