"use client";
// Registers the service worker so the shopping list works in-store on bad signal.
//
// PRODUCTION ONLY, AND DEV ACTIVELY UNREGISTERS. The first version registered everywhere, and
// in development that meant a worker cached against one build kept controlling the origin
// through every rebuild after it — until every navigation rendered the offline page to an
// online browser, persistently, because a page refresh re-registered the same trap. Not
// registering in dev is half the fix; the other half is cleaning up the workers dev sessions
// already have, so recovery does not require anyone to know about DevTools → Application →
// Service Workers → Unregister.
//
// Registration is deferred to `load` so it never competes with first paint.
import { useEffect } from "react";

export function ServiceWorker() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      // Undo any worker a previous session left on this origin, and drop its caches so stale
      // content-hashed assets cannot outlive the build they belonged to.
      void navigator.serviceWorker
        .getRegistrations()
        .then((regs) => Promise.allSettled(regs.map((r) => r.unregister())))
        .catch(() => {});
      if ("caches" in window) {
        void caches
          .keys()
          .then((keys) => Promise.allSettled(keys.filter((k) => k.startsWith("cosmic-")).map((k) => caches.delete(k))))
          .catch(() => {});
      }
      return;
    }

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* SW is an enhancement — never break the page over it */
      });
    };
    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register);
      return () => window.removeEventListener("load", register);
    }
  }, []);
  return null;
}
