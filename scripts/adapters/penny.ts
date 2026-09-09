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
    // ── THE PRICE NODE, AND WHY IT IS THIS NARROW.
    //
    // Penny's tile stacks FOUR amounts inside one wrapper:
    //
    //     preț fără PENNY card   22,99 LEI     ← the shelf price: what anyone pays
    //     1 BC 0,58 LEI                        ← per-unit
    //     preț cu PENNY card     17,99 LEI     ← loyalty price
    //     1 BC 0,45 LEI                        ← per-unit
    //
    // `.ws-product-price-wrapper__container` is the wrapper, so its textContent was all four
    // concatenated and the parser took the LAST currency-attached amount: **0,45**. We
    // published 0,45 lei for a pack that costs 22,99. Found by `audit:discount-truth`, when
    // Penny's own 30-day minimum of 22,99 could not be reconciled with our 0,45.
    //
    // It hid because Penny's catalogue is mostly produce sold by the kilo, where the pack IS
    // one unit and the two figures coincide. It was wrong on 4 of 29 offers — LIBRESSE 40 buc
    // stored at 0,45 against a real 17,99, a 40x error on a live comparison page.
    //
    // `.ws-product-price-value__main` is the amount alone, and the FIRST one is the non-card
    // price. That is the right choice for a cross-store comparison: a loyalty price is not
    // available to everyone, and storing it in `price` made Penny undercut every merchant
    // whose shelf price we hold.
    price: [".ws-product-price-value__main", '[data-test="product-price-type-value"]'],
    // The card price, kept rather than discarded — a different claim, its own column.
    loyalty: ['[data-test="product-price-type"]:nth-of-type(2) .ws-product-price-value__main'],
    // ── THE 30-DAY MINIMUM, read explicitly instead of being avoided.
    //
    // Penny prints the EU-Omnibus figure on every tile, in its own node with its own test
    // hook: `preț minim ultimele 30 de zile: 6,99 LEI`. Narrowing the `price` selector above
    // to dodge the validity dates threw this away too, and it is the reason the OMNIBUS_30D
    // column held ZERO rows across the entire database while `probe:omnibus` found the figure
    // on 5 of 5 Penny pages. Of the eleven merchants that probe reads, Penny is the only one
    // that publishes it.
    //
    // Reading it here is safe in a way widening `price` was not: the runner takes ONLY the
    // reference fields from this node and discards any current price it might yield.
    reference: ['[data-test="product-price-lowest-price"]', ".ws-product-price-information__lowest-price"],
    image: ["img.ws-product-image", "img"],
    link: ['a[data-test="product-tile-link"]', "a[href]"],
  },
};
