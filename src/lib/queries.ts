import { prisma } from "@/lib/db";
import { normalizeText } from "@/lib/matching";

/** An offer's price in bani. Sorting and comparison use this, never the legacy float. */
const baniOf = (o: { price: number; priceBani?: number | null }): number => o.priceBani ?? Math.round(o.price * 100);
import { rankSearch } from "@/lib/search/rank";
import { buildDailyLowSeries, dropPercent, summarize, MAX_DISPLAY_AGE_DAYS } from "@/lib/pricing";
import { visibleTiers } from "./bulk-tiers";

const activeInclude = {
  where: { merchant: { active: true } },
  // `tiers` rides along so a listing card can show the quantity discount. DCNeu is a
  // discounter: the ladder IS the offer, and a card showing only the single-unit price shows
  // the least attractive number on it.
  include: { merchant: true, tiers: { orderBy: { minQuantity: "asc" } } },
} as const;

/**
 * What "a price we can stand behind" means, expressed as a Prisma filter.
 *
 * The SAME rule as `isCurrent` in lib/pricing, pushed down to the database so a page does not
 * fetch a thousand month-old rows to discard them in JavaScript. Both must agree; the test
 * `summarize — only a price we can stand behind` covers the predicate, and this is its query
 * twin.
 *
 * `isStale` alone was not enough: it is set by the scrape and 3,468 Auchan offers were 26 days
 * old with isStale=false, so the age is checked directly against the observation date.
 */
export function currentOfferWhere(now: Date = new Date()) {
  return {
    merchant: { active: true },
    availability: "in stock",
    isStale: false,
    lastObservedAt: { gte: new Date(now.getTime() - MAX_DISPLAY_AGE_DAYS * 86_400_000) },
  } as const;
}

/** Active grocery chains that actually have offers — for the "my stores" picker. */
export async function getStoreList() {
  const merchants = await prisma.merchant.findMany({
    where: { active: true, offers: { some: { product: { section: "grocery" } } } },
    select: { slug: true, name: true, color: true },
    orderBy: { name: "asc" },
  });
  return merchants;
}
export type StoreListItem = Awaited<ReturnType<typeof getStoreList>>[number];

/** Deals hub: grocery products with the biggest price gap between stores (buy-here-save-X),
 *  plus real price drops as history accumulates. */
export async function getDeals(limit = 60) {
  const products = await prisma.product.findMany({
    where: { section: "grocery", offers: { some: {} } },
    include: { offers: { where: { merchant: { active: true } }, include: { merchant: true, history: { orderBy: { recordedAt: "asc" } } } }, category: true },
  });
  const rows = products
    .map((p) => {
      const summary = summarize(p.offers);
      const inStock = p.offers.filter((o) => o.availability === "in stock");
      const pool = inStock.length > 0 ? inStock : p.offers;
      const unitLowest = pool.length > 0 ? Math.min(...pool.map((o) => o.pricePerUnit || 0)) : 0;
      const drop = dropPercent(buildDailyLowSeries(p.offers));
      const savingsPct = summary.highest > 0 ? (summary.savings / summary.highest) * 100 : 0;
      // Integer comparison: exact, and it exercises the column the migration added.
      const cheapest = [...pool].sort((a, b) => baniOf(a) - baniOf(b))[0];
      return { ...p, summary, unitLowest, drop, savingsPct, cheapestStore: cheapest?.merchant.name ?? null, score: Math.max(savingsPct, drop) };
    })
    .filter((p) => p.summary.offerCount >= 2 && p.score >= 8)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return rows;
}
export type DealProduct = Awaited<ReturnType<typeof getDeals>>[number];

export async function getMenuCategories() {
  return prisma.category.findMany({ where: { section: "grocery" }, orderBy: { id: "asc" } });
}
export type MenuCategory = Awaited<ReturnType<typeof getMenuCategories>>[number];

export async function getAlcoholCategories() {
  return prisma.category.findMany({ where: { section: "alcohol" }, orderBy: { id: "asc" } });
}

/** Add headline price + lowest price-per-unit to a product's offers. */
function decorate<T extends {
  offers: {
    price: number; availability: string; pricePerUnit: number;
    priceBani?: number | null; flagged?: boolean; isStale?: boolean;
    tiers?: { minQuantity: number; unitPriceBani: number; discountBp: number | null }[];
  }[];
}>(products: T[]) {
  return products.map((p) => {
    const inStock = p.offers.filter((o) => o.availability === "in stock");
    const pool = inStock.length > 0 ? inStock : p.offers;
    const unitLowest = pool.length > 0 ? Math.min(...pool.map((o) => o.pricePerUnit || 0)) : 0;
    // Best trusted ladder across this product's offers. `visibleTiers` refuses one hanging
    // off a flagged, stale or out-of-stock price, so a card cannot advertise a discount
    // against a base we are withholding.
    let bulk: { bestUnitBani: number; bestFromQty: number; bestDiscountBp: number } | null = null;
    for (const o of p.offers) {
      const l = visibleTiers({
        priceBani: o.priceBani ?? null,
        price: o.price,
        flagged: o.flagged ?? false,
        isStale: o.isStale ?? false,
        availability: o.availability,
        tiers: o.tiers,
      });
      if (l && (!bulk || l.bestUnitBani < bulk.bestUnitBani)) {
        bulk = { bestUnitBani: l.bestUnitBani, bestFromQty: l.bestFromQty, bestDiscountBp: l.bestDiscountBp };
      }
    }
    return { ...p, summary: summarize(p.offers), unitLowest, bulk };
  });
}

export type SortKey = "price-asc" | "unit-asc" | "name";

export async function getCategoryPage(slug: string, sort: SortKey = "unit-asc") {
  const category = await prisma.category.findUnique({ where: { slug } });
  if (!category || category.section !== "grocery") return null; // alcohol lives on /alcool
  const products = await prisma.product.findMany({
    where: { categoryId: category.id, section: "grocery" },
    include: { offers: activeInclude, category: true },
  });
  const decorated = decorate(products).filter((p) => p.summary.offerCount > 0);
  decorated.sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name, "ro");
    if (sort === "price-asc") return a.summary.lowestBani - b.summary.lowestBani;
    return a.unitLowest - b.unitLowest;
  });
  return { category, products: decorated };
}

export async function getItemPage(slug: string) {
  const product = await prisma.product.findUnique({
    where: { slug },
    include: {
      category: true,
      offers: { where: { merchant: { active: true } }, include: { merchant: true, history: { orderBy: { recordedAt: "asc" } }, tiers: { orderBy: { minQuantity: "asc" } } } },
    },
  });
  if (!product) return null;
  const offers = [...product.offers].sort((a, b) => baniOf(a) - baniOf(b));
  const summary = summarize(offers);
  const series = buildDailyLowSeries(offers);
  const inStock = offers.filter((o) => o.availability === "in stock");
  const bestOffer = inStock[0] ?? offers[0] ?? null;

  // "Best time to buy": compare today's lowest to its own price history.
  const lows = series.map((s) => s.price);
  const lowestEver = lows.length ? Math.min(...lows) : summary.lowest;
  const avg = lows.length ? lows.reduce((a, b) => a + b, 0) / lows.length : summary.lowest;
  const priceInsight = {
    points: series.length,
    lowestEver,
    avg,
    atLow: series.length >= 4 && summary.lowest <= lowestEver * 1.01,
    belowAvgPct: series.length >= 4 && avg > 0 ? Math.max(0, ((avg - summary.lowest) / avg) * 100) : 0,
  };
  return { product, offers, summary, series, bestOffer, priceInsight };
}

export type ItemPage = NonNullable<Awaited<ReturnType<typeof getItemPage>>>;
export type OfferRow = ItemPage["offers"][number];

const ALT_STOP = new Set(["de", "cu", "la", "si", "din", "fara", "pentru", "sau", "un", "cel", "bio"]);
function headNounOf(name: string): string {
  return normalizeText(name).split(/\s+/).find((t) => t.length >= 3 && !ALT_STOP.has(t) && !/\d/.test(t)) ?? "";
}

/** Similar items: same section + same type (head-noun) + same size, other products — so a
 *  shopper can find substitutes (other brands / shops), especially for single-shop items. */
/** How willing the shopper is to swap a product for a cheaper equivalent.
 *  "same-brand" — only other packs of the SAME brand (people are loyal to a coffee).
 *  "equivalent" — any product with the same head-noun and size (the default).      */
export type Strictness = "same-brand" | "equivalent";

export async function getAlternatives(productId: number, limit = 8, strictness: Strictness = "equivalent") {
  const p = await prisma.product.findUnique({ where: { id: productId }, select: { id: true, name: true, brand: true, unit: true, unitSize: true, section: true } });
  if (!p) return [];
  const head = headNounOf(p.name);
  if (!head) return [];
  const cands = await prisma.product.findMany({
    where: {
      section: p.section,
      unit: p.unit,
      id: { not: p.id },
      offers: { some: {} },
      unitSize: { gte: p.unitSize * 0.94, lte: p.unitSize * 1.06 },
    },
    include: { offers: activeInclude, category: true },
    take: 500,
  });
  const nbrand = normalizeText(p.brand ?? "");
  let matched = cands.filter((c) => normalizeText(c.name).split(/\s+/).some((t) => t === head));
  // "same brand only": the shopper wants a better price on THIS product, not a substitute.
  // With no brand on the source product there is nothing to hold constant, so the filter
  // would silently return nothing — fall back to equivalents rather than an empty list.
  if (strictness === "same-brand" && nbrand) {
    matched = matched.filter((c) => normalizeText(c.brand ?? "") === nbrand || normalizeText(c.name).includes(nbrand));
  }
  const decorated = decorate(matched).filter((x) => x.summary.offerCount > 0);
  // cheapest first; a different brand is a more useful "alternative" so nudge those up
  decorated.sort((a, b) => {
    const da = nbrand && normalizeText(a.brand ?? "") !== nbrand ? -0.001 : 0;
    const db = nbrand && normalizeText(b.brand ?? "") !== nbrand ? -0.001 : 0;
    return a.summary.lowest + da - (b.summary.lowest + db);
  });
  return decorated.slice(0, limit);
}
export type AltProduct = Awaited<ReturnType<typeof getAlternatives>>[number];

export async function searchProducts(query: string) {
  const q = query.trim();
  if (!q) return [];
  const products = await prisma.product.findMany({
    where: { section: "grocery" },
    include: { offers: activeInclude, category: true },
  });
  // The scoring lives in lib/search/rank.ts so that search quality can be measured without a
  // database. See tests/search-quality.test.ts (40 real queries) and `npm run audit:search`.
  const ranked = rankSearch(q, products);
  return decorate(ranked.map((r) => r.item)).filter((p) => p.summary.offerCount > 0);
}

export type ProductCardData = Awaited<ReturnType<typeof searchProducts>>[number];

export async function suggestProducts(query: string, limit = 6) {
  const results = await searchProducts(query);
  return results.slice(0, limit).map((p) => ({ slug: p.slug, name: p.name, brand: p.brand, lowest: p.summary.lowest }));
}

/**
 * The homepage's two shelves: eight featured products and six with a recent price drop.
 *
 * This used to load EVERY grocery product with EVERY offer and EVERY price-history row —
 * measured at 22,428 products, 31,280 offers and 43,922 history rows, 97,630 rows and 4.4
 * seconds, to render fourteen items. The drop signal was the reason: it needs history, so the
 * whole catalog came with it.
 *
 * The drop is now a precomputed column (`Product.dropPct`, refreshed by `npm run compute:home`
 * at the end of the nightly), so both shelves are bounded queries that touch only the rows they
 * render. Prices change once a night; deriving this per request was paying a full-catalog scan
 * for an answer that had not changed since the last scrape.
 */
export async function getHomeSections() {
  const live = currentOfferWhere();
  const shelf = {
    // No history: neither shelf renders a chart. That single omission is most of the win.
    offers: { where: { merchant: { active: true } }, include: { merchant: true } },
    category: true,
  } as const;

  const [featuredRows, dropRows] = await Promise.all([
    prisma.product.findMany({
      where: { section: "grocery", offers: { some: live } },
      include: shelf,
      orderBy: { id: "asc" },
      // Over-fetch: the offers included below are unfiltered (the card shows stale rows greyed),
      // so a product can still fall out when summarize finds nothing current.
      take: 40,
    }),
    prisma.product.findMany({
      where: { section: "grocery", dropPct: { gt: 2 }, offers: { some: live } },
      include: shelf,
      orderBy: { dropPct: "desc" },
      take: 24, // over-fetch: the 2+ merchant rule below is not expressible in this query
    }),
  ]);

  const decorate = (p: (typeof featuredRows)[number]) => ({
    ...p,
    summary: summarize(p.offers),
    unitLowest: (() => {
      const inStock = p.offers.filter((o) => o.availability === "in stock");
      const pool = inStock.length > 0 ? inStock : p.offers;
      return pool.length > 0 ? Math.min(...pool.map((o) => o.pricePerUnit || 0)) : 0;
    })(),
    drop: p.dropPct ?? 0,
  });

  const featured = featuredRows.map(decorate).filter((p) => p.summary.hasCurrentPrice).slice(0, 8);
  // A "drop" on a single-merchant product is one shop changing its own price, which is not the
  // comparison this shelf is for.
  const drops = dropRows.map(decorate).filter((p) => p.summary.offerCount >= 2).slice(0, 6);
  return { featured, drops };
}

export type HomeProduct = Awaited<ReturnType<typeof getHomeSections>>["featured"][number];

/** Products (with active offers) for a basket, by slug. */
export async function getBasketProducts(slugs: string[]) {
  if (slugs.length === 0) return [];
  return prisma.product.findMany({
    where: { slug: { in: slugs } },
    include: { offers: activeInclude },
  });
}

/**
 * The three numbers on the homepage. Every one of them counts only what a shopper could
 * actually act on right now.
 *
 * The previous version counted any grocery offer from any merchant, which meant a merchant we
 * had switched OFF still counted as a store, and a price last seen months ago still counted as
 * a price. Those are not lies a visitor can check, which is exactly why they have to be right.
 */
const liveOffer = {
  ...currentOfferWhere(),
  product: { section: "grocery" },
} as const;

export async function countStats() {
  const [products, offers, chains] = await Promise.all([
    prisma.product.count({ where: { section: "grocery", offers: { some: liveOffer } } }),
    prisma.offer.count({ where: liveOffer }),
    prisma.merchant.count({ where: { active: true, offers: { some: { isStale: false, product: { section: "grocery" } } } } }),
  ]);
  return { products, offers, chains };
}

/** Alcohol storefront: products in the "alcohol" section, decorated + sorted, with
 *  optional category filter. Comparison across FineStore / Le Manoir. */
export async function getAlcoholPage(sort: SortKey = "price-asc", categorySlug?: string) {
  let categoryId: number | undefined;
  if (categorySlug) {
    const cat = await prisma.category.findUnique({ where: { slug: categorySlug } });
    if (!cat || cat.section !== "alcohol") return { products: [], categories: await getAlcoholCategories() };
    categoryId = cat.id;
  }
  const products = await prisma.product.findMany({
    where: { section: "alcohol", ...(categoryId ? { categoryId } : {}) },
    include: { offers: activeInclude, category: true },
  });
  const decorated = decorate(products).filter((p) => p.summary.offerCount > 0);
  decorated.sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name, "ro");
    if (sort === "unit-asc") return a.unitLowest - b.unitLowest;
    return a.summary.lowest - b.summary.lowest;
  });
  return { products: decorated, categories: await getAlcoholCategories() };
}

/** Sub-categories of a storefront section (for the filter chips). */
export async function getSectionCategories(section: string) {
  return prisma.category.findMany({ where: { section }, orderBy: { name: "asc" } });
}

/** A non-grocery storefront section (dcneu / cosmetice / farmacie), optional text + category. */
export async function getSectionProducts(section: string, sort: SortKey = "price-asc", q?: string, categorySlug?: string) {
  let categoryId: number | undefined;
  if (categorySlug) {
    const c = await prisma.category.findUnique({ where: { slug: categorySlug } });
    if (c?.section === section) categoryId = c.id;
  }
  const products = await prisma.product.findMany({
    where: { section, ...(categoryId ? { categoryId } : {}), ...(q ? { name: { contains: q } } : {}) },
    include: { offers: activeInclude, category: true },
  });
  const decorated = decorate(products).filter((p) => p.summary.offerCount > 0);
  decorated.sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name, "ro");
    if (sort === "unit-asc") return a.unitLowest - b.unitLowest;
    return a.summary.lowest - b.summary.lowest;
  });
  return decorated;
}

export async function getAdminStats() {
  const [products, offers, chains] = await Promise.all([
    prisma.product.count(),
    prisma.offer.count(),
    prisma.merchant.count(),
  ]);
  const merchantRows = await prisma.merchant.findMany({
    include: { _count: { select: { offers: true } } },
    orderBy: { name: "asc" },
  });
  const newest = await prisma.offer.findFirst({ orderBy: { lastObservedAt: "desc" }, select: { lastObservedAt: true } });
  return { products, offers, chains, merchantRows, lastUpdated: newest?.lastObservedAt ?? null };
}
