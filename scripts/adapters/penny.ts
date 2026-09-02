// Penny România — Vue/Nuxt storefront, product tiles are `[data-test="product-tile"]`.
// Penny has no online delivery: these are SHELF prices from the weekly offer pages.
//
// PENNY HAS NO ONLINE CATALOG AT ALL. Its homepage links exactly one category — the current
// week's offers — and nothing else. So the weekly flyer IS the merchant here, and ~30 products
// is the real ceiling, not a symptom of a broken selector. That is worth stating plainly
// because "Penny only has 51 offers" looked like an unfinished scraper for weeks.
//
// WHY THE ROUTE IS DISCOVERED RATHER THAN WRITTEN DOWN. It used to be pinned to
// `oferte-site-kw35` — kw = calendar week. When week 35 ended, that URL began returning a
// 322 KB 404 page that renders perfectly and contains no product tiles, so the scraper read
// zero products and reported "0 parsed" with no indication of why. Verified 2026-09-03:
// kw34 → 404, kw35 → 404, kw36 → 200 with 30 tiles, kw37 → 404. Only the current week exists.
//
// A hardcoded week is a URL with an expiry date nobody set a reminder for, and it would have
// broken again every Monday. Computing the week number locally is barely better — it assumes
// Penny numbers its weeks the way ISO-8601 does, which is our guess about their scheme rather
// than their answer. So we read the link the site itself publishes.
import type { Adapter, Route } from "./types";

const BASE = "https://www.penny.ro";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/**
 * Find the offer categories Penny is currently linking from its own homepage.
 *
 * Deliberately returns [] rather than a guessed URL when it finds nothing: an empty result is
 * recorded by the runner as a failed run, which is the honest outcome. Falling back to a
 * computed week would turn "their site changed" into "0 products", which is the exact failure
 * this replaces.
 */
async function discoverPennyRoutes(): Promise<Route[]> {
  const res = await fetch(BASE, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`homepage HTTP ${res.status}`);
  const html = await res.text();

  const slugs = new Set<string>();
  for (const m of html.matchAll(/href="(\/categorie\/[a-z0-9-]+)"/gi)) slugs.add(m[1]);

  // Offer listings first — they are what Penny actually publishes — but any category link is
  // usable, so a future Penny that grows a real catalog is picked up without a code change.
  const ordered = [...slugs].sort((a, b) => Number(b.includes("oferte")) - Number(a.includes("oferte")));
  return ordered.map((slug) => ({ url: `${BASE}${slug}`, cat: "oferte" }));
}

export const penny: Adapter = {
  slug: "penny",
  name: "Penny",
  websiteUrl: BASE,
  color: "#d40f14",
  storeType: "physical",
  priceChannel: "shelf",
  section: "grocery",
  addNew: true,
  mode: "dom",
  maxPages: 1,
  delayMs: 1500,
  discoverRoutes: discoverPennyRoutes,
  // Kept as the shape's documentation and the offline-fixture path. NOT the live source of
  // truth — `discoverRoutes` replaces it at run time, and this URL is expected to 404 once
  // its week passes.
  routes: [{ url: `${BASE}/categorie/oferte-site-kw36`, cat: "oferte" }],
  dom: {
    card: '[data-test="product-tile"]',
    // the tile's accessible name lives in .show-sr-and-print
    name: [".show-sr-and-print", '[data-test="product-tile-link"]', ".ws-product-tile__title"],
    // IMPORTANT: NOT a loose [class*="price"] — that also matches the validity-range and
    // 30-day-low blocks, whose dates parsed as a price and wrote 1092026 lei onto real
    // products (caught by the sanity gate). Target the regular-price node only.
    price: [".ws-product-price-wrapper__container", '[data-test="product-price"]', ".ws-product-price"],
    image: ["img.ws-product-image", "img"],
    link: ['a[data-test="product-tile-link"]', "a[href]"],
  },
};
