// The searchable catalog, built once per catalog version instead of once per request.
//
// ── WHAT WAS COSTING 880 ms.
//
// `/search` loaded every grocery product with a live price (29,166 rows, 282 ms), every
// offer-count row (29,166 more, 237 ms), then rebuilt the catalog vocabulary, the head-noun
// frequency table and the brand set from scratch inside `searchCatalog` (another 213-241 ms) —
// on every keystroke-triggered suggest call and every search page load.
//
// None of that is per-query. All of it is a pure function of the catalog, and the catalog
// changes once a night.
//
// ── WHY NOT `unstable_cache`.
//
// It serialises through JSON, and what is expensive here is not the array — it is the Maps and
// Sets derived from it. Round-tripping those through JSON would rebuild them on every read,
// which is the cost we are removing. So this is an in-process memo holding the derived
// structures directly.
//
// ── STALENESS, STATED.
//
// Invalidated two ways: `resetSearchIndex()` from /api/revalidate, which the nightly calls after
// the scrape, and a TTL as the backstop for a nightly that did not finish. Inside that window a
// product priced since the last build is not findable, and a brand added since is not known.
// That is a real cost and it is bounded — it does not affect any PRICE shown, because prices are
// read per-request by the page that renders them, not from here.

import { prisma } from "@/lib/db";
import { currentOfferWhere } from "@/lib/queries";
import { buildSearchIndex, type SearchIndex } from "@/lib/search/search";

/** Backstop only. The nightly's revalidate call is the real invalidation. */
const TTL_MS = 10 * 60 * 1000;

export type SearchableProduct = {
  id: number;
  name: string;
  brand: string | null;
  categoryName: string | null;
  merchantCount: number;
};

type Cached = { builtAt: number; catalog: SearchableProduct[]; index: SearchIndex; buildMs: number };

let cache: Cached | null = null;
let inFlight: Promise<Cached> | null = null;

/** Called by /api/revalidate when the nightly finishes. */
export function resetSearchIndex(): void {
  cache = null;
  inFlight = null;
}

async function build(): Promise<Cached> {
  const t0 = Date.now();
  const live = currentOfferWhere();
  const [light, offerCounts, cats] = await Promise.all([
    prisma.product.findMany({
      where: { section: "grocery", offers: { some: live } },
      select: { id: true, name: true, brand: true, categoryId: true },
    }),
    // Offer is unique on (productId, merchantId), so counting live offers per product IS the
    // distinct-shop count — and it is a tie-breaker in ranking, not a filter.
    prisma.offer.groupBy({ by: ["productId"], where: { ...live, product: { section: "grocery" } }, _count: { _all: true } }),
    prisma.category.findMany({ where: { section: "grocery" }, select: { id: true, name: true } }),
  ]);

  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const merchants = new Map(offerCounts.map((r) => [r.productId, r._count._all]));
  const catalog: SearchableProduct[] = light.map((p) => ({
    id: p.id,
    name: p.name,
    brand: p.brand,
    categoryName: p.categoryId == null ? null : catName.get(p.categoryId) ?? null,
    merchantCount: merchants.get(p.id) ?? 0,
  }));

  // The derived index is the expensive half — 213-241 ms of vocabulary, head-noun frequency
  // and brand set. Built here, once, alongside the rows it is derived from.
  const index = buildSearchIndex(catalog);
  return { builtAt: Date.now(), catalog, index, buildMs: Date.now() - t0 };
}

/**
 * The catalog every search ranks against.
 *
 * Concurrent callers share ONE build. Without that, the first search after an invalidation on a
 * page with an autocomplete would start several full catalog reads at once and each would pay
 * the whole cost — the cache would make the worst case worse rather than better.
 */
export async function getSearchableCatalog(): Promise<{ catalog: SearchableProduct[]; index: SearchIndex }> {
  if (cache && Date.now() - cache.builtAt < TTL_MS) return { catalog: cache.catalog, index: cache.index };
  if (inFlight) { const c = await inFlight; return { catalog: c.catalog, index: c.index }; }
  inFlight = build();
  try {
    cache = await inFlight;
    return { catalog: cache.catalog, index: cache.index };
  } finally {
    inFlight = null;
  }
}

/** For diagnostics: how old the cached catalog is, and what it cost to build. */
export function searchIndexStatus(): { cached: boolean; ageMs: number; size: number; buildMs: number } {
  if (!cache) return { cached: false, ageMs: 0, size: 0, buildMs: 0 };
  return { cached: true, ageMs: Date.now() - cache.builtAt, size: cache.catalog.length, buildMs: cache.buildMs };
}
