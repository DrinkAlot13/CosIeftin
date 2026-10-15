// Auchan România — VTEX `catalog_system` search API.
//
// THIS FILE REPLACES A 186-LINE BESPOKE SCRAPER, and the reason is not line count.
//
// `scripts/scrape-auchan.ts` upserted Offer rows itself instead of handing a pool to
// `matchPoolToCatalog`, which meant it was the one merchant with NO price sanity gate: not
// the ">50% from its own last price" rule, not the ">70% from the cross-store median" rule.
// It wrote 28,14 → 12,00 on a Pepsi 6-pack on 30 August and nothing objected, because
// nothing was watching. It also kept no `rawSourceBlob`, so the write could not be audited
// after the fact.
//
// Giving that scraper its own copy of the gates would have been the wrong fix. Every
// safeguard added from then on would have had to be added twice, and the second copy is
// the one that drifts — which is exactly what happened with `ensureBackup()`, guarding
// `matchPoolToCatalog` and `scrape-auchan` separately, the divergence reproducing itself
// inside the fix for the divergence. As a config, Auchan inherits every gate that exists
// now and every gate added later, and the second `ensureBackup()` call site disappears.
//
// VTEX SPECIFICS, so the next VTEX store is a copy of this file:
//   • Single-segment category browsing is GATED: fq=C:2030000 returns []. The FULL PATH
//     works: fq=C:2000000/2030000, where the parent is the id rounded down to 1e6.
//   • Pagination is INCLUSIVE ROW OFFSETS, `_from`/`_to`, not a page number. That is what
//     the runner's {from}/{to} tokens and `pageSize` are for.
//   • The price lives at items[0].sellers[0].commertialOffer.Price — note the VTEX
//     misspelling of "commercial", which is theirs and must be matched exactly.
//   • IsAvailable is a real boolean, so `unavailableWhen: [false]`.
import type { Adapter, Route } from "./types";

const BASE = "https://www.auchan.ro";
const PAGE_SIZE = 50;

/**
 * VTEX subcategory id → our catalog category slug.
 *
 * Carried over verbatim from the bespoke scraper: these ids were found by hand against the
 * live category tree and are the one piece of that file worth keeping.
 */
const CATS: readonly (readonly [number, string])[] = [
  [2030000, "lactate"], [2050000, "lactate"], [2020000, "lactate"],
  [2010000, "mezeluri"], [2040000, "mezeluri"], [2060000, "mezeluri"],
  [4030000, "panificatie"], [4040000, "panificatie"], [4010000, "panificatie"], [4050000, "panificatie"],
  [1020000, "legume-fructe"], [1040000, "legume-fructe"], [1050000, "legume-fructe"], [1030000, "legume-fructe"],
  [5010000, "bauturi"], [5060000, "bauturi"], [5050000, "bauturi"], [5030000, "bauturi"], [5040000, "bauturi"], [3200000, "bauturi"],
  [3010000, "bacanie"], [3130000, "bacanie"], [3140000, "bacanie"], [3150000, "bacanie"],
  [3160000, "bacanie"], [3080000, "bacanie"], [3190000, "bacanie"], [3220000, "bacanie"],
  [3090000, "bacanie"], [3050000, "bacanie"], [3020000, "bacanie"], [3040000, "bacanie"],
  [3060000, "bacanie"], [3070000, "bacanie"], [3170000, "bacanie"], [3210000, "bacanie"],
  [7040000, "menaj"], [7070000, "menaj"], [7080000, "menaj"], [7090000, "menaj"],
  [7050000, "menaj"], [8020000, "menaj"], [8050000, "menaj"], [8070000, "menaj"],
  // Added 2026-10-15: four ENTIRE top-level VTEX departments were missing from this list —
  // not truncated, simply never routed at all. `category/tree` (depth 3, fetched live) shows
  // 13000000 Congelate, 22000000 Ready meals si mezeluri, 24000000 Carne si peste and
  // 28000000 Dietetic si international alongside the seven departments already covered here
  // (1/2/3/4/5/7/8-prefixed ids), and none of their subcategories ever appeared in `CATS`.
  // `resources` totals for the 19 subcategories below sum to ~5,444 real items — frozen food,
  // fresh meat/fish and cold cuts/ready meals that this scraper has never fetched. The final
  // Category is reassigned from the product name by `assign-categories.ts` regardless of the
  // label here, so these are a reasonable department-level hint, not the source of truth.
  [13010000, "congelate"], [13020000, "congelate"], [13030000, "congelate"],
  [13040000, "congelate"], [13050000, "congelate"],
  [22010000, "bacanie"], [22020000, "bacanie"],
  [22030000, "mezeluri"], [22040000, "mezeluri"], [22050000, "mezeluri"],
  [24010000, "carne-peste"], [24020000, "carne-peste"], [24030000, "carne-peste"],
  [24040000, "carne-peste"], [24050000, "carne-peste"], [24060000, "carne-peste"],
  [28010000, "bacanie"], [28020000, "bacanie"], [28030000, "bacanie"],
] as const;

/** fq=C:{parent}/{sub} — the full path, because VTEX refuses the single segment. */
export function categoryRoute(id: number, cat: string): Route {
  const parent = Math.floor(id / 1_000_000) * 1_000_000;
  return {
    url: `${BASE}/api/catalog_system/pub/products/search?fq=C:${parent}/${id}&_from={from}&_to={to}`,
    cat,
  };
}

export const auchan: Adapter = {
  slug: "auchan",
  name: "Auchan",
  websiteUrl: BASE,
  color: "#e2001a",
  storeType: "hybrid",
  priceChannel: "shelf",
  section: "grocery",
  addNew: true,
  mode: "json",
  // 8 × 50 = 400 products per subcategory was far too low: checked live against VTEX's own
  // `resources: N-M/total` header for all 43 routes, 11 subcategories exceed 400 (one has
  // 2,349), and nothing instrumented the runner to say so — it just looked like a smaller,
  // valid catalog. Real max observed is 2,349 (47 pages); set well above it for growth. The
  // runner still stops on an empty page, so this costs nothing for the categories that are
  // genuinely small.
  //
  // Re-checked 2026-10-15 against all 44 routes then live (including the 19 added below):
  // real max is still 2,351 (bacanie subcategory 3190000), well inside the 3,000-item cap.
  // No route is currently truncated.
  maxPages: 60,

  pageSize: PAGE_SIZE,
  delayMs: 700,
  routes: CATS.map(([id, cat]) => categoryRoute(id, cat)),
  json: {
    // the search endpoint returns a bare top-level array
    items: "",
    name: "productName",
    price: "items.0.sellers.0.commertialOffer.Price",
    image: "items.0.images.0.imageUrl",
    link: "linkText",
    brand: "brand",
    ean: "items.0.ean",
    available: "items.0.sellers.0.commertialOffer.IsAvailable",
    unavailableWhen: [false],
  },
  // VTEX product pages are /{linkText}/p — `abs()` alone would build a 404. The bespoke
  // scraper did this inline; here it is the one line of code in an otherwise declarative file.
  refine: (sp) => {
    const withP = (u: string): string => (u.endsWith("/p") ? u : u.replace(/\/+$/, "") + "/p");
    return { ...sp, url: withP(sp.url), productUrl: sp.productUrl ? withP(sp.productUrl) : sp.productUrl };
  },
};
