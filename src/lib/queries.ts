import { prisma } from "@/lib/db";
import { deliveryPlatformWhere } from "@/lib/platform/visibility";
import { normalizeText } from "@/lib/matching";

/** An offer's price in bani. Sorting and comparison use this, never the legacy float. */
const baniOf = (o: { price: number; priceBani?: number | null }): number => o.priceBani ?? Math.round(o.price * 100);
import { searchCatalog } from "@/lib/search/search";
import { buildDailyLowSeries, dropPercent, isCurrent, summarize, MAX_DISPLAY_AGE_DAYS } from "@/lib/pricing";
import { visibleTiers } from "./bulk-tiers";

const activeInclude = {
  where: { merchant: { active: true } },
  // `tiers` rides along so a listing card can show the quantity discount. DCNeu is a
  // discounter: the ladder IS the offer, and a card showing only the single-unit price shows
  // the least attractive number on it.
  include: { merchant: true, tiers: { orderBy: { minQuantity: "asc" } } },
} as const;

/**
 * EVERY COLUMN A PRODUCT CARD USES, AND NOT ONE MORE.
 *
 * `activeInclude` above selects whole Offer rows, because `include` has no other setting. Whole
 * Offer rows carry `rawSourceBlob` — the verbatim source record we keep so a parser change can
 * be checked against history. It averages 1,413 bytes and totals 71 MB, which is 41% of the
 * database, and no card has ever shown a byte of it.
 *
 * Measured: /search hydrated 25,676 offers and pulled roughly 34.6 MB of blob through the ORM
 * into JavaScript objects to render product tiles; /oferte pulled about 47.7 MB. That is not a
 * query-planning problem and no index touches it — it is asking for columns nobody reads.
 *
 * These are the fields `isCurrent`, `summarize`, `decorate` and `<ProductCard>` actually use.
 * `merchantId` is here because search counts distinct shops; the merchant's NAME is not,
 * because a card does not show it. Anything needing more (the item page's offer table) says so
 * at its own call site.
 */
const cardOfferSelect = {
  where: { merchant: { active: true } },
  select: {
    price: true, priceBani: true, pricePerUnit: true,
    availability: true, isStale: true, flagged: true,
    priceSource: true, lastObservedAt: true, merchantId: true,
    tiers: { select: { minQuantity: true, unitPriceBani: true, discountBp: true }, orderBy: { minQuantity: "asc" } },
  },
} as const;

/** The product columns a card renders. `nameNorm`, `ean`, `rawSourceBlob`'s siblings: not here. */
const cardProductSelect = {
  id: true, slug: true, name: true, brand: true, unit: true, unitSize: true,
  image: true, section: true, categoryId: true, dropPct: true,
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
export function currentOfferWhere(now: Date = new Date(), showDeliveryPlatform = false) {
  return {
    merchant: { active: true },
    availability: "in stock",
    isStale: false,
    // DELIVERY_PLATFORM prices carry a platform markup and are OFF by default everywhere —
    // optimizer, item pages, deals, counts, search, comparability. See lib/platform/visibility.
    ...(showDeliveryPlatform ? {} : { NOT: { priceSource: "DELIVERY_PLATFORM" } }),
    // Must match isCurrent: a withheld offer is not a current price. Its absence here meant
    // every listing and count treated flagged rows as live.
    flagged: false,
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

/**
 * Deals hub: the biggest between-store gaps and the real price drops.
 *
 * THIS USED TO LOAD THE WHOLE CATALOG. Measured: 25,610 products, 35,365 offers and 53,839
 * price-history rows — 114,814 rows, roughly 48 MB of it `rawSourceBlob` — to render sixty
 * cards, at 6.4 seconds a request. It is the same bug the homepage had and the same fix: the
 * two things it needed the whole catalog for (the spread, the drop) are now columns computed
 * once a night by `npm run compute:home`.
 *
 * `dealScore` is max(spread, drop) precisely so the sort is expressible in SQL. Ordering by the
 * greater of two columns in JavaScript means loading every row first, which is the bug.
 *
 * The offers are still loaded for the sixty that survive, because `summary.savings` is the
 * number on the card and it must be the live one, not a nightly snapshot of it. Sixty products'
 * offers is about 130 rows.
 */
export async function getDeals(limit = 60) {
  const rows = await prisma.product.findMany({
    where: {
      section: "grocery",
      // Two shops or it is not a comparison — the rule was a JavaScript filter over everything,
      // and it is now part of the query.
      liveOfferCount: { gte: 2 },
      dealScore: { gte: 8 },
    },
    select: { ...cardProductSelect, spreadPct: true, dealScore: true,
      offers: { where: cardOfferSelect.where, select: { ...cardOfferSelect.select, merchant: { select: { name: true } } } } },
    orderBy: { dealScore: "desc" },
    // Over-fetch a little: `summarize` re-derives the headline from the offers as they are RIGHT
    // NOW, so a product whose last live price aged out since the nightly falls away here.
    take: limit * 2,
  });

  return rows
    .map((p) => {
      const summary = summarize(p.offers);
      const inStock = p.offers.filter((o) => isCurrent(o as never));
      const pool = inStock.length > 0 ? inStock : p.offers;
      const unitLowest = pool.length > 0 ? Math.min(...pool.map((o) => o.pricePerUnit || 0)) : 0;
      const cheapest = [...pool].sort((a, b) => baniOf(a) - baniOf(b))[0];
      return {
        ...p,
        summary,
        unitLowest,
        drop: p.dropPct ?? 0,
        savingsPct: summary.highest > 0 ? (summary.savings / summary.highest) * 100 : 0,
        cheapestStore: cheapest?.merchant.name ?? null,
        score: p.dealScore ?? 0,
      };
    })
    .filter((p) => p.summary.offerCount >= 2)
    .slice(0, limit);
}
export type DealProduct = Awaited<ReturnType<typeof getDeals>>[number];

/**
 * The header and footer menus: DEPARTMENTS ONLY.
 *
 * This returned every grocery category — 93 of them once the two-level tree was populated — and
 * the header's hover panel rendered all 93 in a grid, as did the homepage. A menu with
 * ninety-three entries is not a menu, it is the problem the menu was meant to solve.
 *
 * A department is the right altitude for a top-level menu: thirteen entries, each of which
 * opens onto its own shelves. The shelves live in the sidebar, one click in, where a shopper is
 * already looking at that department.
 */
export async function getMenuCategories() {
  return prisma.category.findMany({
    where: { section: "grocery", parentId: null },
    orderBy: { id: "asc" },
  });
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
    const inStock = p.offers.filter((o) => isCurrent(o as never));
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

/**
 * A category page, for a SHELF or for a DEPARTMENT.
 *
 * Departments used to render empty. Every product sits on a leaf — that is an invariant the
 * assigner enforces — so `categoryId = <department>` matches nothing, and /c/lactate-oua showed
 * "Niciun produs în această categorie" for a department holding 1,367 of them.
 *
 * That was survivable while nothing linked to a department. The homepage grid now shows
 * departments, and a tile that opens onto "no products" is worse than no tile. A department
 * page is the union of its shelves, which is what a shopper reading the word expects.
 */
export async function getCategoryPage(slug: string, sort: SortKey = "unit-asc") {
  const category = await prisma.category.findUnique({
    where: { slug },
    include: { children: { select: { id: true } } },
  });
  if (!category || category.section !== "grocery") return null; // alcohol lives on /alcool
  // A department is its leaves; a leaf is itself. Never both — a product on a department would
  // otherwise be counted here and nowhere in the sidebar, and the two would disagree.
  const ids = category.children.length > 0 ? category.children.map((c) => c.id) : [category.id];
  const products = await prisma.product.findMany({
    where: { categoryId: { in: ids }, section: "grocery" },
    select: { ...cardProductSelect, offers: cardOfferSelect },
  });
  const decorated = decorate(products).filter((p) => p.summary.offerCount > 0);
  decorated.sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name, "ro");
    if (sort === "price-asc") return a.summary.lowestBani - b.summary.lowestBani;
    return a.unitLowest - b.unitLowest;
  });
  return { category, products: decorated };
}

/**
 * The uncategorised listing.
 *
 * Same shape and same filter as `getCategoryPage`, on purpose: these products are ordinary in
 * every way except that nothing has managed to classify them, and showing them through a
 * different code path would be how their prices quietly start behaving differently.
 */
export async function getUncategorisedPage(sort: SortKey = "unit-asc", page = 1, perPage = 120) {
  const products = await prisma.product.findMany({
    where: { categoryId: null, section: "grocery" },
    select: { ...cardProductSelect, offers: cardOfferSelect },
  });
  const decorated = decorate(products).filter((p) => p.summary.offerCount > 0);
  decorated.sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name, "ro");
    if (sort === "price-asc") return a.summary.lowestBani - b.summary.lowestBani;
    return a.unitLowest - b.unitLowest;
  });
  // PAGINATED, because the page rendered all 3,729 of them: 4.4 MB of HTML and 32,709 DOM
  // nodes, 2.7 seconds to become usable. The TOTAL stays exact and is what the page reports —
  // the point of this listing is that the tail is visible, so its size must not be rounded off
  // by pagination.
  const total = decorated.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(Math.max(1, page), pages);
  return { products: decorated.slice((current - 1) * perPage, current * perPage), total, page: current, pages, perPage };
}

export async function getItemPage(slug: string, showDeliveryPlatform = false) {
  const product = await prisma.product.findUnique({
    where: { slug },
    include: {
      category: true,
      // A WITHHELD OFFER DOES NOT RENDER AT ALL.
      //
      // Out-of-stock rows stay, greyed, with their last-seen date — that is a fact about a
      // shop that does carry the product. A FLAGGED row is different: it is one a gate
      // withheld, which means we do not believe the price, the match, or both.
      //
      // The Pepsi page proved the difference. After a full re-scrape it still rendered
      // "Mega Image · Stoc epuizat · 10,49 RON" and the same for Carrefour — on a six-pack
      // neither of them sells. Those rows were stale AND withheld, and still claimed two
      // shops carried the product. Greying a false claim does not make it true.
      //
      // AND A DELIVERY-PLATFORM OFFER DOES NOT RENDER EITHER, unless explicitly asked for.
      // This where clause is its own — `currentOfferWhere` carries the exclusion but is not
      // used here — so the item page was the one surface that would have listed a Glovo price
      // in the same table as shelf prices, under a heading that says "cel mai mic preț".
      offers: {
        where: { merchant: { active: true }, flagged: false, ...deliveryPlatformWhere(showDeliveryPlatform) },
        include: { merchant: true, history: { orderBy: { recordedAt: "asc" } }, tiers: { orderBy: { minQuantity: "asc" } } },
      },
    },
  });
  if (!product) return null;
  const offers = [...product.offers].sort((a, b) => baniOf(a) - baniOf(b));
  const summary = summarize(offers);
  const series = buildDailyLowSeries(offers);
  const inStock = offers.filter((o) => isCurrent(o as never));
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

/**
 * Products that meet the SAME NEED, at whichever shop sells them.
 *
 * Different question from `getAlternatives`, which finds products with the same head noun and a
 * similar pack size regardless of whether they are interchangeable. This one uses the
 * equivalence class — the thing the substitution engine actually substitutes within — so what
 * comes back is what the basket would really give you at another shop.
 *
 * The shop is the point. "Auchan sells eggs L 10-pack and Mega sells a different brand of eggs
 * L 10-pack" is two answers to one need, and a comparison site that shows only the first is
 * hiding the reason it exists. Each row therefore carries its cheapest CURRENT offer and the
 * merchant behind it, and the same product appearing at three shops appears three times — once
 * per shop, priced.
 */
export async function getClassEquivalents(productId: number, limit = 12) {
  const p = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, equivalenceClassId: true, equivalenceClass: { select: { label: true, unit: true } } },
  });
  if (!p?.equivalenceClassId) return { label: null, rows: [] };

  const siblings = await prisma.product.findMany({
    where: { equivalenceClassId: p.equivalenceClassId },
    select: {
      id: true, slug: true, name: true, brand: true, unit: true, unitSize: true,
      offers: {
        where: { ...currentOfferWhere(), merchant: { active: true } },
        select: {
          price: true, priceBani: true, pricePerUnit: true, url: true, productUrl: true,
          merchant: { select: { id: true, name: true, slug: true } },
        },
      },
    },
  });

  // One row per (product, shop): the same eggs at three shops are three offers to compare.
  const rows = siblings.flatMap((sib) =>
    sib.offers.map((o) => ({
      productId: sib.id,
      slug: sib.slug,
      name: sib.name,
      brand: sib.brand,
      unit: sib.unit,
      isSelf: sib.id === p.id,
      merchantName: o.merchant.name,
      merchantSlug: o.merchant.slug,
      priceBani: o.priceBani ?? Math.round(o.price * 100),
      pricePerUnit: o.pricePerUnit,
      url: o.productUrl ?? o.url,
    })),
  );
  rows.sort((a, b) => (a.pricePerUnit || Infinity) - (b.pricePerUnit || Infinity) || a.priceBani - b.priceBani);
  return { label: p.equivalenceClass?.label ?? null, rows: rows.slice(0, limit) };
}
export type ClassEquivalents = Awaited<ReturnType<typeof getClassEquivalents>>;

/**
 * Search the grocery catalog.
 *
 * TWO RULES ARE ENFORCED HERE RATHER THAN IN THE RANKER, because they are about what may be
 * SHOWN and the ranker is pure:
 *
 *  1. ONLY SHOWABLE PRODUCTS ARE SEARCHABLE. A stale, withheld, out-of-stock or
 *     inactive-merchant row is not a search result — the same definition of "shown" the listing
 *     pages use. Searching used to rank the whole `grocery` section and only drop empties
 *     afterwards, so a withheld product could occupy the top slot and then render with no price.
 *  2. `merchantCount` is computed from those same showable offers and handed to the ranker as
 *     the tie-break: a product priced in four shops is a more useful answer than one priced in
 *     one, and that is the entire point of a comparison site.
 *
 * The outcome is structured, not an array: search must be able to say "we do not stock illy"
 * rather than answering with the category. See lib/search/search.ts.
 */
/**
 * Search, in two phases: rank against everything, hydrate only what is shown.
 *
 * WHY IT HAS TO SEE THE WHOLE CATALOG. `searchCatalog` answers "we do not stock this" by
 * building the catalog's vocabulary and brand set — that is the honesty guarantee the illy
 * case exists for, and narrowing the SQL would quietly turn "we have no illy" back into
 * "here are 208 things that are not illy". So phase one still loads every grocery product
 * with a live price.
 *
 * WHAT IT DOES NOT NEED IS EVERY COLUMN. It used to load whole Product rows WITH their whole
 * Offer rows: 17,919 products, 25,676 offers, and roughly 34.6 MB of `rawSourceBlob` that
 * ranking never reads and a card never shows. 4.8 seconds a query. Ranking uses four fields.
 *
 * Phase two then hydrates one page of results with the card columns. The COUNT comes from
 * phase one, so it is the true number of matches and not the size of the page.
 */
const SEARCH_PER_PAGE = 120;

export async function searchProducts(query: string, page = 1, perPage = SEARCH_PER_PAGE) {
  const q = query.trim();
  const live = currentOfferWhere();

  // ── PHASE 1: the whole catalog, four columns of it.
  //
  // ONE RETURN PATH, so the result type is inferred once. An early `return` for the empty query
  // used to widen this into a union and every caller had to narrow it; the empty case skips the
  // work instead of leaving through a different door.
  const [light, offerCounts, cats] = q
    ? await Promise.all([
        prisma.product.findMany({
          where: { section: "grocery", offers: { some: live } },
          select: { id: true, name: true, brand: true, categoryId: true },
        }),
        // Offer is unique on (productId, merchantId), so counting live offers per product IS
        // the distinct-merchant count. One grouped query instead of hydrating 25,676 offer rows.
        prisma.offer.groupBy({ by: ["productId"], where: { ...live, product: { section: "grocery" } }, _count: { _all: true } }),
        prisma.category.findMany({ where: { section: "grocery" }, select: { id: true, name: true } }),
      ])
    : [[], [], []] as [
        { id: number; name: string; brand: string | null; categoryId: number | null }[],
        { productId: number; _count: { _all: number } }[],
        { id: number; name: string }[],
      ];

  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const merchants = new Map(offerCounts.map((r) => [r.productId, r._count._all]));
  const searchable = light.map((p) => ({
    id: p.id,
    name: p.name,
    brand: p.brand,
    categoryName: p.categoryId == null ? null : catName.get(p.categoryId) ?? null,
    merchantCount: merchants.get(p.id) ?? 0,
  }));

  const outcome = searchCatalog(q, searchable);
  const ranked = outcome.results.map((r) => r.item.id);
  const total = ranked.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(Math.max(1, page), pages);
  const pageIds = ranked.slice((current - 1) * perPage, current * perPage);

  // ── PHASE 2: card columns, for this page only, in rank order.
  const hydrated = pageIds.length === 0 ? [] : await prisma.product.findMany({
    where: { id: { in: pageIds } },
    select: { ...cardProductSelect, offers: cardOfferSelect },
  });
  const byId = new Map(hydrated.map((h) => [h.id, h]));
  const inOrder = pageIds.map((id) => byId.get(id)).filter((x): x is NonNullable<typeof x> => x != null);

  return {
    kind: outcome.kind,
    missing: outcome.missing,
    corrections: outcome.corrections,
    products: decorate(inOrder).filter((p) => p.summary.offerCount > 0),
    total,
    page: current,
    pages,
  };
}

export type SearchResult = Awaited<ReturnType<typeof searchProducts>>;
export type ProductCardData = SearchResult["products"][number];

export async function suggestProducts(query: string, limit = 6) {
  // One page of `limit` results, not the whole ranking hydrated and then thrown away — this is
  // called on every keystroke of the header autocomplete.
  const { products } = await searchProducts(query, 1, limit);
  return products.slice(0, limit).map((p) => ({ slug: p.slug, name: p.name, brand: p.brand, lowest: p.summary.lowest }));
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
    // No history: neither shelf renders a chart. That single omission was most of the win, and
    // dropping `merchant: true` and the rest of the Offer row is the rest of it — a card shows
    // a price and a shop count, never the merchant record or `rawSourceBlob`.
    ...cardProductSelect,
    offers: cardOfferSelect,
  } as const;

  const [featuredRows, dropRows] = await Promise.all([
    prisma.product.findMany({
      where: { section: "grocery", offers: { some: live } },
      select: shelf,
      orderBy: { id: "asc" },
      // Over-fetch: the offers included below are unfiltered (the card shows stale rows greyed),
      // so a product can still fall out when summarize finds nothing current.
      take: 40,
    }),
    prisma.product.findMany({
      where: { section: "grocery", dropPct: { gt: 2 }, offers: { some: live } },
      select: shelf,
      orderBy: { dropPct: "desc" },
      take: 24, // over-fetch: the 2+ merchant rule below is not expressible in this query
    }),
  ]);

  const decorate = (p: (typeof featuredRows)[number]) => ({
    ...p,
    summary: summarize(p.offers),
    unitLowest: (() => {
      const inStock = p.offers.filter((o) => isCurrent(o as never));
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
/**
 * A FUNCTION, NOT A CONSTANT — and that is the whole point of this note.
 *
 * This was `const liveOffer = { ...currentOfferWhere(), … }` at module scope, so
 * `currentOfferWhere()` ran ONCE, when the module was first imported, and its
 * `lastObservedAt >= now − 14 days` was pinned to the moment the server booted. A server up for
 * a week counted prices up to 21 days old as live, and the longer it stayed up the further the
 * window drifted. Every one of the three homepage counters used it.
 *
 * Nothing about that is visible: the numbers stay plausible and simply get slowly wronger. It
 * is the shape this project keeps meeting — a value captured once and read as if it were
 * current — and the fix is the same as always: ask at the time you need the answer.
 */
const liveOffer = () => ({
  ...currentOfferWhere(),
  product: { section: "grocery" },
}) as const;

/**
 * ONE FILTER FOR ALL THREE COUNTERS.
 *
 * `chains` used to key on `isStale: false` alone while the other two used `liveOffer`, so it
 * counted a merchant whose prices are not shown: glovo-kaufland has 2,217 non-stale grocery
 * offers and ZERO visible ones, because DELIVERY_PLATFORM is excluded everywhere. The homepage
 * was about to claim NINE stores while eight had a price a visitor could see — and the cached
 * 8 was right only by accident, because the cache predated the Glovo ingest.
 *
 * Same shape as the two outlier thresholds, the two size parsers and the two definitions of
 * "shown": one question, two spellings, and nothing to say which was right. The fix is the
 * same — one definition, used by all three.
 */
export async function countStats() {
  const live = liveOffer(); // evaluated per call — see the note on liveOffer
  const [products, offers, chains, depth] = await Promise.all([
    prisma.product.count({ where: { section: "grocery", offers: { some: live } } }),
    prisma.offer.count({ where: live }),
    prisma.merchant.count({ where: { active: true, offers: { some: live } } }),
    // ── THE FOURTH NUMBER, AND THE ONLY HONEST ONE OF THE FOUR.
    //
    // "37.258 produse" is true and, on its own, misleading: 91.6% of them are priced by exactly
    // one shop, so most of that catalog cannot be compared at all. Turning on `addNew` for three
    // merchants grew the priced catalog 63% in a day, and a headline that grows with it while
    // saying nothing about comparability is a claim the site cannot support.
    //
    // So the count of products a shopper can actually COMPARE sits beside the others. It went
    // 1,917 → 2,449 across the same change, which is the number that says the change was worth
    // making — and if it had fallen, this line is where that would have shown.
    prisma.offer.groupBy({ by: ["productId"], where: { ...live, product: { section: "grocery" } }, _count: { _all: true } }),
  ]);
  const comparable = depth.filter((d) => d._count._all >= 2).length;
  return { products, offers, chains, comparable };
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
