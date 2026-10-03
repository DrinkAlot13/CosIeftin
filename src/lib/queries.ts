import { prisma } from "@/lib/db";
import { deliveryPlatformWhere } from "@/lib/platform/visibility";
import { normalizeText } from "@/lib/matching";
import { headNoun, overlapTokens, doseTokens } from "@/lib/scrape-util";

/** An offer's price in bani. Sorting and comparison use this, never the legacy float. */
const baniOf = (o: { price: number; priceBani?: number | null }): number => o.priceBani ?? Math.round(o.price * 100);
import { searchCatalog } from "@/lib/search/search";
import { getSearchableCatalog, type SearchableProduct } from "@/lib/search/index-cache";
import { buildDailyLowSeries, dropPercent, isCurrent, summarize, MAX_DISPLAY_AGE_DAYS } from "@/lib/pricing";
import { priceStory } from "@/lib/price-story";
import { visibleTiers } from "./bulk-tiers";
import { MEDIAN_DEVIATION } from "./outlier";
import { INDEX_BASKET, type BasketItem } from "./index-basket";

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
  // Precomputed by `compute:home`. Carried so the "preț bun acum" filter can run in the BROWSER
  // — a category page that reads searchParams cannot be cached in Next 14, and this page is
  // cached on purpose. One boolean per card is cheaper than the history it stands for.
  atObservedLow: true,
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
      const unitLowest = pool.length > 0 ? lowestKnownPerUnit(pool) : 0;
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
    const unitLowest = pool.length > 0 ? lowestKnownPerUnit(pool) : 0;
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

  // ── HOW MANY SHOPS ACTUALLY SHOW A PRICE, counted over the SAME offers the card summarises.
  //
  // Counted from `isCurrent` offers rather than from every row, so it agrees with the price the
  // card displays. A product whose second shop is stale is not comparable today, whatever the
  // database says about it in general.
  const withShops = decorate(products)
    .filter((p) => p.summary.offerCount > 0)
    .map((p, i) => ({
      ...p,
      shopCount: new Set(
        products[i].offers.filter((o) => isCurrent(o as never)).map((o) => o.merchantId),
      ).size,
    }));

  // ── THE FILTERING ITSELF LIVES IN THE BROWSER, and it has to.
  //
  // Reading `searchParams` makes a page dynamic in Next 14, which is exactly why sorting moved
  // client-side in the first place — see `SortableProductGrid`. A `?comparabile=` link would
  // undo that and re-render every category for every visitor to change which subset is drawn.
  //
  // So the server hands over EVERY product with the shop count attached, and the grid decides
  // what to draw. The page stays generated once and revalidated when prices change.
  withShops.sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name, "ro");
    if (sort === "price-asc") return a.summary.lowestBani - b.summary.lowestBani;
    return a.unitLowest - b.unitLowest;
  });

  return {
    category,
    products: withShops,
    /** So the toggle can say what it is hiding without recounting in the browser. */
    comparableCount: withShops.filter((p) => p.shopCount >= 2).length,
  };
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
      // Whether this is a shop's OWN brand. Needed to explain, in Romanian, WHY a product sits
      // at one shop: "only Auchan sells it" is a fact about the product, while "only one shop
      // has a price today" is a fact about our coverage, and a shopper deserves to know which.
      attributes: { where: { key: "isPrivateLabel" }, select: { value: true } },
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
      // ── DELIVERY-PLATFORM OFFERS NOW RENDER, AND VISIBLE IS NOT THE SAME AS ELIGIBLE.
      //
      // Phase 3 decision: a Bucharest shopper can genuinely order Kaufland through Glovo, so
      // hiding the price hides a real purchasing option — and `audit:platform` found 3,142
      // products (9.8% of live grocery) that are IN STOCK only at a platform and therefore
      // showed no price at all.
      //
      // The guarantee that makes this safe is already in `isCurrent`, which excludes
      // DELIVERY_PLATFORM by default: `summarize` and `bestOffer` are both built from it, so a
      // platform price cannot become "cel mai mic preț" or the recommended shop no matter how
      // cheap it is. The row is listed and labelled; it is not eligible to win.
      //
      // `showDeliveryPlatform` no longer gates whether the rows EXIST — it is kept for the API,
      // which has its own callers and its own default.
      offers: {
        where: { merchant: { active: true }, flagged: false },
        include: { merchant: true, history: { orderBy: { recordedAt: "asc" } }, tiers: { orderBy: { minQuantity: "asc" } } },
      },
    },
  });
  if (!product) return null;
  const offers = [...product.offers].sort((a, b) => baniOf(a) - baniOf(b));
  const summary = summarize(offers);
  const series = buildDailyLowSeries(offers);
  const inStock = offers.filter((o) => isCurrent(o as never));
  // ── THE FALLBACK MAY NOT REACH A PLATFORM OFFER.
  //
  // `?? offers[0]` was safe while delivery-platform rows were filtered out of this query. Now
  // that they render (Phase 3), `offers[0]` is the cheapest row of ANY kind — so on a product
  // whose only in-stock prices are Glovo, the "best offer" became a Glovo offer, and with it the
  // lei/L figure and the "Vezi la …" button. Caught on the Zuzu 1,8 l page, which showed
  // "7,77 lei/L" derived from a platform price with no label anywhere near it.
  //
  // The rule is that a platform price is never the recommendation, so the fallback is over SHELF
  // rows only. When there are none, there is no best offer, and the page says that.
  const shelfOffers = offers.filter((o) => (o.priceSource ?? "") !== "DELIVERY_PLATFORM");
  const bestOffer = inStock[0] ?? shelfOffers[0] ?? null;

  // ── "IS THIS A GOOD PRICE?" — ONE IMPLEMENTATION, IN `lib/price-story`.
  //
  // This used to be computed inline here and rendered as **"preț la minimul istoric"**. On 35
  // days of history — the table began 2026-08-06 — "istoric" is a claim the data cannot support,
  // and it fired on `series.length >= 4` without ever checking how long that span actually was.
  // Four observations inside one week would have announced a historic low.
  //
  // `priceStory` states the span it measured instead of naming a window, and refuses to speak at
  // all under a fortnight. Keeping the old computation beside it would be two answers to one
  // question, which is the defect `check:concepts` exists for.
  const observations = product.offers
    .filter((o) => (o.priceSource ?? "") !== "DELIVERY_PLATFORM")
    .flatMap((o) =>
      o.history
        .map((h) => ({ priceBani: h.priceBani ?? Math.round(h.price * 100), at: h.recordedAt }))
        .filter((x) => Number.isFinite(x.priceBani) && x.priceBani > 0),
    );
  const story = priceStory(summary.lowestBani ?? Math.round(summary.lowest * 100), observations);

  return { product, offers, summary, series, bestOffer, story };
}

export type ItemPage = NonNullable<Awaited<ReturnType<typeof getItemPage>>>;
export type OfferRow = ItemPage["offers"][number];

/**
 * The anchor noun for "similar products" — the matcher's, not a second one.
 *
 * ── THIS WAS THE THIRD COPY OF THE IDEA, AND IT SHIPPED THE WORST RESULT.
 *
 * `scrape-util.headNoun` was made brand-aware after measurement showed 27.2% of branded grocery
 * rows lead with their brand. This file kept a separate implementation and was left behind, so
 * for `aro Ulei Floarea Soarelui 6 x 1 L` it returned **"aro"** — and every other `aro` product
 * at a similar size became a "similar" suggestion. That is how a shopper looking at sunflower
 * oil was offered LEMONADE at 4,23 with a one-click "+ adaugă":
 *
 *     aro Ulei Floarea Soarelui 6 x 1 L
 *        similar: aro Bautura Carbogazoasa Aroma Lamaie si Lime SGR 12 x 0,5 L
 *
 * It was then made brand-aware TOO, which fixed the symptom and left two implementations that
 * could drift apart again. Measured across all 56,609 product names before collapsing them: the
 * two tokenizers are effectively identical (one token differs in 5,000 names) and the two head
 * nouns disagreed on **64 names, 0.1%** — entirely because this copy's stopword list excluded
 * `bio` and the matcher's does not. `audit:alternatives` is the referee and reports 85.7%
 * coverage at 2.99 suggestions per product either way.
 */
const headNounOf = (name: string, brand?: string | null): string =>
  headNoun(normalizeText(name), normalizeText(brand ?? ""));

/** Similar items: same section + same type (head-noun) + same size, other products — so a
 *  shopper can find substitutes (other brands / shops), especially for single-shop items. */
/** How willing the shopper is to swap a product for a cheaper equivalent.
 *  "same-brand" — only other packs of the SAME brand (people are loyal to a coffee).
 *  "equivalent" — any product with the same head-noun and size (the default).      */
export type Strictness = "same-brand" | "equivalent";

/**
 * Default size band for "similar products" — the same question the substitution engine's
 * structural fallback asks (`src/lib/substitution/resolve.ts`'s EQUIVALENT case, when no
 * curated `EquivalenceClass` exists), at the tolerance this browse feature was tuned and
 * audited at (`audit:alternatives`: 85.7% coverage, 2.99 suggestions/product). The basket
 * resolver calls `structuralCandidateIds` with a LOOSER tolerance of its own — "close enough to
 * buy instead of going without" is a weaker bar than "worth showing as a browse suggestion" —
 * but through this SAME function, so there remains exactly one head-noun-based candidate rule
 * rather than a second copy that can drift the way the old `headNounOf` duplicate did.
 */
export const ALTERNATIVES_SIZE_TOLERANCE = 0.06;

/**
 * The basket resolver's own tolerance for the SAME structural-candidate query, used only when
 * a line's product has no curated `EquivalenceClass` (3.7% of grocery products have one,
 * measured 2026-10-02). Looser than `ALTERNATIVES_SIZE_TOLERANCE` on purpose: "close enough to
 * buy instead of going home without it" is a weaker bar than "worth surfacing as a browse
 * suggestion". Tuned against `audit:substitution-coverage`'s 95%-per-merchant bar, not guessed
 * — see that script's header for the measured history of what each value achieved.
 */
export const BASKET_STRUCTURAL_TOLERANCE = 0.35;

/**
 * Other products sharing this one's head noun, canonical unit, and a size band — the candidate
 * SET for "would a shopper accept this instead", before any pricing/decoration/strictness is
 * applied. Returns ids only: what to DO with the candidates (decorate for a browse card here,
 * fold into a basket resolution elsewhere) is the caller's concern, not this query's.
 */
export async function structuralCandidateIds(
  p: { id: number; name: string; brand: string | null; unit: string; unitSize: number; section: string },
  sizeTolerance: number,
  opts: { requireMutualDistinction?: boolean; take?: number } = {},
): Promise<number[]> {
  const head = headNounOf(p.name, p.brand);
  if (!head) return [];
  const cands = await prisma.product.findMany({
    where: {
      section: p.section,
      unit: p.unit,
      id: { not: p.id },
      offers: { some: {} },
      unitSize: { gte: p.unitSize * (1 - sizeTolerance), lte: p.unitSize * (1 + sizeTolerance) },
    },
    select: { id: true, name: true, brand: true },
    take: opts.take ?? 500,
  });
  // ── BOTH SIDES MUST BE THE SAME KIND OF THING, not merely share a word.
  //
  // The old test was "the candidate's name CONTAINS the source's head noun anywhere", which is
  // satisfied by any name that happens to include the word. `Unt Albalact, 82% grasime, 200 g`
  // was offered `MUNTE LACT Creminos cu Unt 60% 200 g` — a cheese spread — because that name
  // contains the token "unt". Sorted cheapest-first, so the wrong product led.
  //
  // Requiring the candidate's OWN head noun to be the same word makes both sides assert what
  // they are, rather than one side merely mentioning it. A cheese spread's head noun is
  // `creminos`, not `unt`.
  let matched = cands.filter((c) => headNounOf(c.name, c.brand) === head);

  // ── A HEAD NOUN CAN BE TOO GENERIC TO CARRY THE WHOLE JUDGEMENT, AND SIZE STOPS GUARDING
  //    AGAINST IT AS THE SIZE BAND WIDENS.
  //
  // At `ALTERNATIVES_SIZE_TOLERANCE` (6%), two products rarely share an almost-identical pack
  // size unless they are genuinely the same kind of thing, so a generic head noun ("tablete",
  // "bautura", "crema") was accidentally screened by size agreement. At the basket resolver's
  // much looser tolerance that screen weakens, and it failed outright: measured on a random
  // 50-item sample (`audit:substitution-coverage`), "Tablete de ciocolată amăruie cu 72% cacao
  // 100g" — chocolate — was offered "Tablete odorizante pentru rezervorul toaletei" — TOILET
  // BOWL CLEANER TABLETS — as a substitute, both head-nouned to "tablete", both 4-count packs.
  // Soy milk ("alpro Bautura din Soia") was likewise offered a pineapple-coconut juice drink, and
  // a depilatory cream was offered reparative hand cream — "bautura" and "crema" are category
  // words, not product names. So callers using the wider tolerance ask for this extra check:
  // mutual distinction, the same structural signal `decide()` uses for "is this the same
  // catalog row" (CLAUDE.md's matching rules) — if EACH side carries significant tokens the
  // other lacks, they are different things. It is intentionally skipped for
  // `ALTERNATIVES_SIZE_TOLERANCE` callers (unaudited behaviour change otherwise) and intentionally
  // LIGHTER than decide()'s version — one side being a fuller description of the same product
  // (brand name, a flavour word) must not disqualify a substitute, only a product that is
  // plainly a different kind of thing should.
  if (opts.requireMutualDistinction) {
    matched = matched.filter((c) => passesMutualDistinction(p.name, c.name));
  }

  return matched.map((c) => c.id);
}

/**
 * The ONE mutual-distinction check, extracted so `structuralCandidateIds` and
 * `semanticCandidateIds` (below) share it rather than each keeping a copy that can drift —
 * see the `headNoun` duplicate incident this project already paid for once.
 *
 * EITHER side carrying 2+ tokens the other lacks disqualifies the pair. "Crema depilatoare Veet
 * Aloe Vera și Vitamina E pentru piele sensibilă" vs "NIVEA Crema" has nothing unshared on the
 * SHORT side, so an AND-of-both check passed it — hand cream as a depilatory cream's substitute.
 * The requested product carrying several tokens the candidate never mentions is itself the
 * warning sign, independent of what the candidate adds back.
 */
export function passesMutualDistinction(
  nameA: string, nameB: string,
  opts: { strict?: boolean; brandA?: string | null; brandB?: string | null } = {},
): boolean {
  // Brand tokens are stripped before counting, same reasoning as `headNoun`'s own brand-skip:
  // a different brand repeating itself in the name is not a second product fact, it is the
  // brand. Without this, `strict` mode below would block every cross-brand match on the brand
  // WORD alone ("MEDA Cabanos" vs "aro Cabanos" differ only by brand and nothing else).
  const brandTokens = (b?: string | null) => new Set(b ? overlapTokens(normalizeText(b)) : []);
  const aBrand = brandTokens(opts.brandA);
  const bBrand = brandTokens(opts.brandB);
  const aOver = new Set([...overlapTokens(normalizeText(nameA))].filter((t) => !aBrand.has(t)));
  const bOver = new Set([...overlapTokens(normalizeText(nameB))].filter((t) => !bBrand.has(t)));
  const aOnly = [...aOver].filter((t) => !bOver.has(t));
  const bOnly = [...bOver].filter((t) => !aOver.has(t));
  // `strict`: EITHER side having even ONE unshared (non-brand) token disqualifies the pair, not
  // just two. Built for `semanticCandidateIds`, measured necessary rather than assumed: the
  // loose "2+ on BOTH sides" rule that is correctly calibrated for the structural (head-noun)
  // tier let "Chipsuri cu paprica" pass against "Chipsuri cu sare" (one unshared word each
  // side — a real flavour swap, not a rephrasing) and "aro Napolitane Cacao" against "...
  // Vanilie" the same way. A high embedding score does not compensate for this — both scored
  // 0.93-0.95, as high as genuine matches. The cost is real too: it also blocks some good
  // matches ("Balsam de păr-spray Gliss..." vs "Gliss ... Balsam de Păr", differing only by the
  // word "spray"), which is the right trade per this project's own rule — a missed comparison
  // costs nothing, a false one costs trust — doubly so for this, the least-certain tier.
  if (opts.strict) return aOnly.length === 0 && bOnly.length === 0;
  return aOnly.length < 2 && bOnly.length < 2;
}

/**
 * Cosine similarity between two embedding vectors, both already L2-normalized at
 * computation time (`compute-embeddings.ts`), so this is just the dot product.
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

function toFloat32Array(bytes: Uint8Array): Float32Array {
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

/**
 * The THIRD, weakest substitution tier: semantic similarity, for when a product has no curated
 * class AND `structuralCandidateIds` (same head noun) finds nothing — the recall gap a head-noun
 * match cannot close by construction, because two products describing the same thing in
 * different words never share a head noun at all.
 *
 * MEASURED, NOT ASSUMED: a BGE-M3 cosine-similarity threshold alone is not a safe accept/reject
 * decision — "crema depilatoare" against "crema de mâini" scores 0.856, HIGHER than two genuine
 * coffee-bean matches scored against each other (0.827-0.841). So this is a candidate FINDER
 * only: `MIN_SIMILARITY` is set low enough to catch real synonyms, and every candidate still has
 * to pass `passesMutualDistinction` before being returned — the same token-based safety gate the
 * structural tier uses, not a second, independent judgement call.
 */
const SEMANTIC_MIN_SIMILARITY = 0.8;

export async function semanticCandidateIds(
  p: { id: number; name: string; brand: string | null; unit: string; unitSize: number; section: string; embedding: Uint8Array | null },
  sizeTolerance: number,
  take = 500,
): Promise<number[]> {
  if (!p.embedding) return [];
  const pVec = toFloat32Array(p.embedding);
  const pDose = doseTokens(p.name);
  const cands = await prisma.product.findMany({
    where: {
      section: p.section,
      unit: p.unit,
      id: { not: p.id },
      embedding: { not: null },
      offers: { some: {} },
      unitSize: { gte: p.unitSize * (1 - sizeTolerance), lte: p.unitSize * (1 + sizeTolerance) },
    },
    select: { id: true, name: true, brand: true, embedding: true },
    take,
  });
  return cands
    .filter((c) => c.embedding && cosineSimilarity(pVec, toFloat32Array(c.embedding)) >= SEMANTIC_MIN_SIMILARITY)
    // A stated strength must not CONTRADICT (3.5% milk is not the 1.5% class) — measured
    // necessary: "Lapte Uht 3.5%" scored 0.979 against "Lapte Uht 1.5%", HIGHER than every
    // genuine match found in the same sample. Cosine similarity cannot see a number swap; only
    // an explicit dose comparison can.
    .filter((c) => { const cDose = doseTokens(c.name); return !pDose || !cDose || pDose === cDose; })
    .filter((c) => passesMutualDistinction(p.name, c.name, { strict: true, brandA: p.brand, brandB: c.brand }))
    .map((c) => c.id);
}

export async function getAlternatives(productId: number, limit = 8, strictness: Strictness = "equivalent") {
  const p = await prisma.product.findUnique({ where: { id: productId }, select: { id: true, name: true, brand: true, unit: true, unitSize: true, section: true } });
  if (!p) return [];
  const ids = await structuralCandidateIds(p, ALTERNATIVES_SIZE_TOLERANCE);
  if (ids.length === 0) return [];
  const cands = await prisma.product.findMany({
    where: { id: { in: ids } },
    include: { offers: activeInclude, category: true },
  });
  const nbrand = normalizeText(p.brand ?? "");
  let matched = cands;
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
  // Every field the caller reads, on EVERY return path. Omitting the two counts here made them
  // `number | undefined` at the call site, and the page would have compared `undefined > 0` —
  // false, so the section would silently never render for an unclassed product. Correct by
  // accident is still the shape of bug this project keeps finding.
  if (!p?.equivalenceClassId) return { label: null, rows: [], otherShopCount: 0, equivalentCount: 0 };

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
  const shown = rows.slice(0, limit);

  // ── "LA ALTE MAGAZINE" HAS TO BE TRUE.
  //
  // A class is a claim that two shops both sell something interchangeable, and stock moves
  // daily: `crenvursti-450g` held three live members and ALL THREE were at Mega Image, so the
  // item page rendered "Produse echivalente la alte magazine" over a table where every row was
  // the shop the reader was already looking at — including the product itself. The old guard
  // was `rows.length > 1`, which counts rows, and rows are per (product, shop).
  //
  // What the heading claims is a fact about SHOPS, so it is computed about shops: is there an
  // equivalent — a DIFFERENT product — at a merchant that does not already sell this one? The
  // page picks its heading from this rather than asserting the stronger of the two.
  const ownShops = new Set(shown.filter((r) => r.isSelf).map((r) => r.merchantSlug));
  const others = shown.filter((r) => !r.isSelf);
  const shopsElsewhere = new Set(others.filter((r) => !ownShops.has(r.merchantSlug)).map((r) => r.merchantSlug));

  return {
    label: p.equivalenceClass?.label ?? null,
    rows: shown,
    /** Equivalents that exist at a shop which does not already sell this product. */
    otherShopCount: shopsElsewhere.size,
    /** Equivalents that exist at all, anywhere — including this product's own shops. */
    equivalentCount: others.length,
  };
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

  // ── PHASE 1: the whole catalog — but built ONCE PER CATALOG VERSION, not per request.
  //
  // It still ranks against everything, because that is what makes "we do not stock illy" a real
  // answer rather than a shrug. What changed is that loading 29,166 products, 29,166 offer-count
  // rows and rebuilding the vocabulary, head-noun table and brand set is now done when the
  // catalog changes rather than on every keystroke: 520 ms of queries and 230 ms of derivation,
  // per request, for data that moves once a night.
  //
  // See lib/search/index-cache for the staleness this buys and how it is invalidated.
  const { catalog: searchable, index } = q
    ? await getSearchableCatalog()
    : { catalog: [] as SearchableProduct[], index: undefined };

  const outcome = searchCatalog(q, searchable, index);
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
      return pool.length > 0 ? lowestKnownPerUnit(pool) : 0;
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

/**
 * Products (with active offers) for a basket, by slug.
 *
 * ── DELIVERY-PLATFORM OFFERS ARE EXCLUDED BY DEFAULT, AND THEY WERE NOT.
 *
 * `activeInclude` is `{ merchant: { active: true } }` and the three Glovo storefronts ARE
 * active, so every basket the optimizer built could spend the shopper's money at a platform
 * price — /lista was rendering "Completează coșul la Profi (Glovo)" with a marked-up total and
 * no label anywhere on it. CLAUDE.md states the optimizer excludes these; nothing implemented it.
 *
 * Phase 3 splits the two ideas: a platform price is VISIBLE on a product page, where it can be
 * labelled and where it cannot win "cel mai mic preț" — and it is OUT of a basket
 * recommendation unless the shopper opts in, because a median +11.8% markup buried inside one
 * total is not something a reader can see.
 */
export async function getBasketProducts(slugs: string[], includeDeliveryPlatform = false) {
  if (slugs.length === 0) return [];
  return prisma.product.findMany({
    where: { slug: { in: slugs } },
    include: {
      offers: {
        ...activeInclude,
        where: { ...activeInclude.where, ...deliveryPlatformWhere(includeDeliveryPlatform) },
      },
    },
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
/**
 * The lowest unit price among offers that HAVE one — 0 when none do.
 *
 * `Offer.pricePerUnit` is 0 when the scraper could not read a size off the product's own name
 * ("Chec festiv Auchan, pret/kg", "Avocado, pret pe bucata"). That is "unknown", not "free", and
 * its twin column `pricePerUnitBani` says so honestly with a NULL — the same line of
 * scrape-util writes both. 6,791 live offers are in that state.
 *
 * The old expression was `Math.min(...pool.map((o) => o.pricePerUnit || 0))`, so a single
 * unknown dragged the minimum to 0 for the whole product. The card hides a 0, so nothing WRONG
 * was displayed — but `SortableProductGrid` sorts on this number, and 0 sorts first, so
 * "cheapest per unit" listed the products whose unit price we could not compute AT THE TOP.
 * An unknown presented as the best answer.
 *
 * Unknowns are now skipped. If every offer is unknown the result is 0, which the card already
 * treats as "nothing to show" and the sort now sends to the end.
 */
function lowestKnownPerUnit(pool: { pricePerUnit: number }[]): number {
  const known = pool.map((o) => o.pricePerUnit).filter((v) => v > 0);
  return known.length > 0 ? Math.min(...known) : 0;
}

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

  // ── THE FIFTH NUMBER, AND IT IS A SEPARATE NUMBER ON PURPOSE.
  //
  // Equivalence classes let a shopper compare Auchan's own 500 g brown sugar with Mega Image's
  // own 500 g brown sugar. Those are DIFFERENT PRODUCTS — different brands, different names —
  // and the matcher is right to keep them apart. So they are not "comparable" in the sense the
  // count above measures, and folding them in would make that count jump overnight by changing
  // what the word means. Afterwards there would be no way to tell whether the site had got
  // better or the metric had got looser.
  //
  // Two numbers, both labelled. `comparable` only ever moves when a real cross-shop MATCH is
  // made; this one also moves when a class is written. They answer different questions and the
  // homepage prints both.
  const classSpans = await prisma.equivalenceClass.findMany({
    select: {
      id: true,
      products: {
        where: { offers: { some: live } },
        select: { id: true, offers: { where: live, select: { merchantId: true } } },
      },
    },
  });
  const equivalentIds = new Set<number>();
  for (const c of classSpans) {
    // A class earns its keep only if it reaches TWO SHOPS. One shop's products sharing a class
    // is a tidy catalog, not a comparison, and counting it would be the same inflation again.
    const shops = new Set(c.products.flatMap((p) => p.offers.map((o) => o.merchantId)));
    if (shops.size < 2) continue;
    for (const p of c.products) equivalentIds.add(p.id);
  }
  const comparableIds = new Set(depth.filter((d) => d._count._all >= 2).map((d) => d.productId));
  for (const id of comparableIds) equivalentIds.add(id);
  const comparableOrEquivalent = equivalentIds.size;

  return { products, offers, chains, comparable, comparableOrEquivalent };
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

// ── THE HOMEPAGE LEADS WITH WHAT THE SITE IS GOOD AT ──────────────────────────────────────
//
// Measured: 7.3% of grocery products are comparable, but 52.5% of the forty pinned staples are.
// The site is strong on what people actually buy and thin on the long tail — and the homepage
// opened with a category grid, which shows neither. The two queries below surface the strength.

export type SpreadRow = {
  id: number; slug: string; name: string; brand: string | null; image: string | null;
  unit: string; unitSize: number;
  lowestBani: number; highestBani: number; spreadBani: number; spreadPct: number;
  cheapestShop: string; dearestShop: string; shopCount: number;
  categoryId: number | null;
};

/**
 * Products where shopping at the right shop saves the most.
 *
 * ── WHY THE BOUNDS, and they are not decoration.
 *
 * A price spread across shops is EXACTLY the shape that a false match also produces: two
 * different products under one row, one cheap and one dear. CLAUDE.md's peer-median section is
 * explicit that such a check "flags disagreement, not guilt", and the gelatine case showed the
 * flagged row being the CORRECT one. Publishing the biggest spreads on the homepage without
 * bounds would put this project's most likely data errors on its most visited page.
 *
 * So: `flagged` offers are excluded (they already are, by `currentOfferWhere`), and anything
 * above `MEDIAN_DEVIATION` — a spread wider than a factor the median cannot explain — is
 * withheld rather than celebrated. A 30% saving on yoghurt is a real finding a shopper can act
 * on; a 400% "saving" is almost always two products wearing one name.
 */
export async function getBiggestSpreads(limit = 12): Promise<SpreadRow[]> {
  const live = currentOfferWhere();
  const rows = await prisma.product.findMany({
    where: { section: "grocery", offers: { some: live } },
    select: {
      id: true, slug: true, name: true, brand: true, image: true, unit: true, unitSize: true,
      categoryId: true,
      offers: { where: live, select: { price: true, priceBani: true, merchant: { select: { name: true, slug: true } } } },
    },
  });

  const out: SpreadRow[] = [];
  for (const p of rows) {
    const byMerchant = new Map<string, { bani: number; name: string }>();
    for (const o of p.offers) {
      const bani = o.priceBani ?? Math.round(o.price * 100);
      if (!(bani > 0)) continue;
      const prev = byMerchant.get(o.merchant.slug);
      if (!prev || bani < prev.bani) byMerchant.set(o.merchant.slug, { bani, name: o.merchant.name });
    }
    if (byMerchant.size < 2) continue;

    const entries = [...byMerchant.values()].sort((a, b) => a.bani - b.bani);
    const lowest = entries[0];
    const highest = entries[entries.length - 1];
    const spread = highest.bani - lowest.bani;
    if (spread <= 0) continue;

    // ── THE BOUND, AND IT DEPENDS ON HOW MANY SHOPS THERE ARE.
    //
    // With exactly TWO prices there is no median worth the name: one cheap row and one dear row
    // are equally likely to be two different products under one name as they are to be a
    // bargain. CLAUDE.md's peer-median section is about precisely this, and the homepage is the
    // worst possible place to publish that ambiguity.
    //
    // The first version allowed any spread under 2.4x regardless of shop count, and the top
    // twelve came back as brandy, caviar, five coffees and three detergents — every one of them
    // "2 magazine" with an 80-90% gap. Expensive, thin evidence, and not what anybody buys.
    //
    // So a two-shop product must be modest to appear at all, while three or more shops — where
    // a middle price exists to make the outer ones legible — may be wider.
    const ratio = highest.bani / lowest.bani - 1;
    const allowed = byMerchant.size >= 3 ? MEDIAN_DEVIATION : 0.5;
    if (ratio > allowed) continue;

    out.push({
      id: p.id, slug: p.slug, name: p.name, brand: p.brand, image: p.image,
      unit: p.unit, unitSize: p.unitSize,
      lowestBani: lowest.bani, highestBani: highest.bani,
      spreadBani: spread, spreadPct: (spread / lowest.bani) * 100,
      cheapestShop: lowest.name, dearestShop: highest.name, shopCount: byMerchant.size,
      categoryId: p.categoryId,
    });
  }

  // Rank by MONEY SAVED, not by percentage. Saving 8 lei on cheese beats saving 60% on a 2-lei
  // packet of yeast, and the shopper is deciding where to spend an afternoon.
  out.sort((a, b) => b.spreadBani - a.spreadBani);

  // ── AT MOST TWO PER CATEGORY, because absolute lei has a bias and it shows.
  //
  // Expensive goods have larger absolute gaps, so ranking on money saved returns the expensive
  // tail: the unfiltered top twelve was SEVEN COFFEES, a caviar and a gin. Every row was
  // individually correct and the page was useless — nobody's weekly shop is decided by the
  // eleventh coffee.
  //
  // This does not pretend to know what people buy; `getBasketStaples` is the section that does.
  // It just refuses to spend the whole shelf on one aisle.
  const perCategory = new Map<number, number>();
  const spread: SpreadRow[] = [];
  for (const r of out) {
    const key = r.categoryId ?? -1;
    const n = perCategory.get(key) ?? 0;
    if (n >= 2) continue;
    perCategory.set(key, n + 1);
    spread.push(r);
    if (spread.length >= limit) break;
  }
  return spread;
}

export type StapleRow = {
  key: string; label: string; group: string; slug: string;
  lowestBani: number | null; cheapestShop: string | null; shopCount: number;
  spreadBani: number;
};

/**
 * The forty pinned staples, each with its cheapest shop and its spread.
 *
 * This is the site's strongest surface — 52.5% of these compare across two or more shops against
 * 7.3% of the catalog — and until now nothing on the homepage linked to it.
 *
 * A line whose slug no longer resolves is returned with nulls rather than dropped. Dropping it
 * would quietly shrink the basket, which is the exact failure `lib/index-basket.ts` was written
 * to prevent: an index whose contents move cannot measure anything.
 */
export async function getBasketStaples(): Promise<StapleRow[]> {
  const live = currentOfferWhere();
  const products = await prisma.product.findMany({
    where: { slug: { in: INDEX_BASKET.map((b: BasketItem) => b.slug) } },
    select: {
      slug: true,
      offers: { where: live, select: { price: true, priceBani: true, merchant: { select: { name: true, slug: true } } } },
    },
  });
  const bySlug = new Map(products.map((p) => [p.slug, p]));

  return INDEX_BASKET.map((b: BasketItem) => {
    const p = bySlug.get(b.slug);
    const byMerchant = new Map<string, { bani: number; name: string }>();
    for (const o of p?.offers ?? []) {
      const bani = o.priceBani ?? Math.round(o.price * 100);
      if (!(bani > 0)) continue;
      const prev = byMerchant.get(o.merchant.slug);
      if (!prev || bani < prev.bani) byMerchant.set(o.merchant.slug, { bani, name: o.merchant.name });
    }
    const entries = [...byMerchant.values()].sort((a, b2) => a.bani - b2.bani);
    return {
      key: b.key, label: b.label, group: b.group, slug: b.slug,
      lowestBani: entries[0]?.bani ?? null,
      cheapestShop: entries[0]?.name ?? null,
      shopCount: entries.length,
      spreadBani: entries.length >= 2 ? entries[entries.length - 1].bani - entries[0].bani : 0,
    };
  });
}
