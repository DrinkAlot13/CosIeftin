// ── SCOPE: REPORT ONLY. Nothing here writes.
//
// The three questions /admin/stats exists to answer:
//
//   1. HOW DEEP IS THE CATALOG — how many shops price each product. A comparison site with one
//      price per product is a catalogue, not a comparison, so this is the number that says
//      whether the thing works at all.
//   2. WHAT IS EACH MERCHANT ACTUALLY CONTRIBUTING — pooled, written, refused, and with what
//      provenance. A merchant pooling 7,000 products and matching 700 is a completely different
//      problem from one pooling 300, and until you can see both numbers side by side you cannot
//      tell which you have.
//   3. WHERE WOULD MATCHING EFFORT PAY — the pooled products that matched nothing, grouped by
//      why.
//
// TWO DENOMINATORS, ALWAYS BOTH, ALWAYS LABELLED.
//
// "Products in scope" counts every product in the section, including ones no shop currently
// prices. "Products with a live price" counts only those a shopper could act on today. The
// second is canonical — the first flatters every ratio computed against it, because the catalog
// accumulates products faster than merchants price them — but reporting only the canonical one
// hides how much of the catalog is dormant. So both, side by side, named.

import { prisma } from "@/lib/db";
import { currentOfferWhere } from "@/lib/queries";
import { INDEX_BASKET, BASKET_VERSION } from "@/lib/index-basket";
import { RECIPES } from "@/data/recipes";
import { BUCKETS, classifyOffer, STALE_AFTER_DAYS, type Bucket, type CensusRow } from "@/lib/offer-census";
import { isPlaceholderImage } from "@/lib/placeholder-image";

/** How far back the per-merchant table looks. The brief's window, and the soak's. */
export const WINDOW_NIGHTS = 14;

/**
 * ── WHAT EACH COLUMN CAN SPEAK FOR, AND SINCE WHEN.
 *
 * A REPORTING SURFACE IS THE ONE PLACE A WRONG NUMBER LOOKS EXACTLY LIKE A FINDING. Every other
 * component is checked against something; the thing doing the checking is not. This page has now
 * invented the fault it reported twice in one sitting:
 *
 *   • "91,973 pooled, 4,395 written" — fourteen nights summed against fourteen nights summed,
 *     printed side by side as though they were a ratio, sending a reader hunting a scraper bug
 *     that did not exist;
 *   • "7 tăcute" against Mega Image — rows written before the flag existed, counted as though
 *     the flag had measured them.
 *
 * Both are the same shape as the defect this project keeps meeting, arriving in the tool built
 * to watch for it. So the periods are written down here, shown on the page, and any check on one
 * of these columns must be scoped to rows that could have carried it.
 *
 * The dates are the commit that introduced the field, cross-checked against the earliest row
 * that actually holds a value — they are not always the same, and where they differ the LATER
 * one is what the column can speak for.
 */
export const INSTRUMENTED_SINCE: { field: string; since: string; note: string }[] = [
  { field: "ScraperRun.aborted (derived from offersWritten)", since: "2026-09-02",
    note: "before this a run could write nothing and record success; 46 such rows exist, all older than this date" },
  { field: "ScraperRun.offersWritten", since: "2026-09-02",
    note: "counted at the write site; earlier runs report offersParsed, which is a different thing" },
  { field: "ScraperRun.censusJson", since: "2026-08-31", note: "where each merchant's offers landed, per run" },
  { field: "Offer.rawSourceBlob / categoryPath", since: "2026-08-31",
    note: "provenance coverage before this date is absence of recording, not absence of data" },
  { field: "Offer.lastObservedAt", since: "2026-09-01",
    note: "column added then; the earliest value it holds is 2026-08-06, carried over from lastSeenAt" },
  { field: "PendingMatch / PriceAnomaly", since: "2026-08-31", note: "the review queue and the refusal ledger" },
  { field: "poolCompleteness.withUsableImage", since: "2026-09-07", note: "images that are not spinners or data: URIs" },
  { field: "Product.spreadPct / dealScore / liveOfferCount", since: "2026-09-07", note: "the precomputed shelf signals" },
  { field: "ScraperRun.productsCreated", since: "2026-09-08",
    note: "products a run CREATED rather than matched; earlier runs read 0 because the column did not exist, not because they created nothing" },
];

/**
 * When `recordScraperRun` began deriving `aborted` from `offersWritten === 0` (commit 533fae2).
 *
 * Runs recorded before this could not carry the flag, so a zero-write run from then is history,
 * not a fault. Any check on that flag must be scoped to rows that could have had it — the same
 * rule `audit-db` follows for every backfilled column.
 */
export const ABORT_GUARD_LANDED = new Date("2026-09-02T00:00:00Z");

// ── 1. PRICE DEPTH ────────────────────────────────────────────────────────────

export type DepthBucket = { merchants: string; products: number; shareOfPriced: number };

export type DepthTable = {
  label: string;
  /** Everything in this set, priced or not. The flattering denominator. */
  inScope: number;
  /** Those with at least one live visible offer. CANONICAL. */
  withLivePrice: number;
  buckets: DepthBucket[];
  /** Products in scope that no shop prices right now. */
  unpriced: number;
};

/** productId → how many merchants show a live visible price. */
async function liveDepthByProduct(): Promise<Map<number, number>> {
  // Offer is unique on (productId, merchantId), so counting live offers per product IS the
  // distinct-merchant count. Computed here rather than read from `Product.liveOfferCount`,
  // which compute:home writes for the grocery section only — a page that silently reported 0
  // for every other section would be worse than one that takes an extra query.
  const rows = await prisma.offer.groupBy({
    by: ["productId"],
    where: currentOfferWhere(),
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.productId, r._count._all]));
}

function tabulate(label: string, productIds: number[], depth: Map<number, number>): DepthTable {
  const counts = new Map<string, number>([["1", 0], ["2", 0], ["3", 0], ["4", 0], ["5+", 0]]);
  let withLivePrice = 0;
  for (const id of productIds) {
    const n = depth.get(id) ?? 0;
    if (n === 0) continue;
    withLivePrice++;
    const key = n >= 5 ? "5+" : String(n);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return {
    label,
    inScope: productIds.length,
    withLivePrice,
    unpriced: productIds.length - withLivePrice,
    buckets: [...counts.entries()].map(([merchants, products]) => ({
      merchants,
      products,
      shareOfPriced: withLivePrice === 0 ? 0 : (products / withLivePrice) * 100,
    })),
  };
}

export type PriceDepth = {
  overall: DepthTable;
  bySection: DepthTable[];
  basket: DepthTable;
  recipes: DepthTable;
  basketVersion: number;
  /** Basket lines whose pinned product is not in the catalog at all. */
  basketMissing: string[];
  /** Recipe classes with no product attached. */
  recipeClassesEmpty: string[];
};

export async function getPriceDepth(): Promise<PriceDepth> {
  const depth = await liveDepthByProduct();

  const all = await prisma.product.findMany({ select: { id: true, section: true, slug: true, equivalenceClassId: true } });
  const overall = tabulate("Tot catalogul", all.map((p) => p.id), depth);

  const sections = [...new Set(all.map((p) => p.section))].sort();
  const bySection = sections.map((s) => tabulate(s, all.filter((p) => p.section === s).map((p) => p.id), depth));

  // ── The pinned-40 basket. These are the products the Index is computed from, so their depth
  //    is the depth a shopper reading the Index actually experiences.
  const bySlug = new Map(all.map((p) => [p.slug, p.id]));
  const basketIds: number[] = [];
  const basketMissing: string[] = [];
  for (const item of INDEX_BASKET) {
    const id = bySlug.get(item.slug);
    if (id == null) basketMissing.push(item.label);
    else basketIds.push(id);
  }
  const basket = tabulate(`Coșul Index (v${BASKET_VERSION}, ${INDEX_BASKET.length} linii)`, basketIds, depth);

  // ── The recipe classes. A recipe resolves through an EquivalenceClass, so the set in scope is
  //    every product attached to a class a recipe names.
  const classSlugs = [...new Set(RECIPES.flatMap((r) => r.ingredients.map((i) => i.classSlug)))];
  const classes = await prisma.equivalenceClass.findMany({
    where: { slug: { in: classSlugs } },
    select: { id: true, slug: true, _count: { select: { products: true } } },
  });
  const classIds = new Set(classes.map((c) => c.id));
  const recipeIds = all.filter((p) => p.equivalenceClassId != null && classIds.has(p.equivalenceClassId)).map((p) => p.id);
  const known = new Set(classes.map((c) => c.slug));
  const recipeClassesEmpty = [
    ...classSlugs.filter((s) => !known.has(s)).map((s) => `${s} (clasa nu există)`),
    ...classes.filter((c) => c._count.products === 0).map((c) => `${c.slug} (0 produse)`),
  ];
  const recipes = tabulate(`Clasele din rețete (${classSlugs.length} clase)`, recipeIds, depth);

  return { overall, bySection, basket, recipes, basketVersion: BASKET_VERSION, basketMissing, recipeClassesEmpty };
}

/**
 * THE LADDER FROM "every offer row" TO THE NUMBER ON THE HOMEPAGE.
 *
 * The census counts 53,285 offers; the homepage says 20,348 prețuri. Both are right and they
 * look like a contradiction, which cost a round of "can we increase those numbers" before anyone
 * could say where the difference went. Every step is one filter, with what it removed beside it,
 * so the two numbers can never look like a disagreement again.
 */
export type LadderStep = { label: string; offers: number; removed: number; why: string };

export async function getOfferLadder(): Promise<LadderStep[]> {
  const base = { merchant: { active: true } } as const;
  const notStale = { ...base, isStale: false } as const;
  const inStock = { ...notStale, availability: "in stock" } as const;
  const notFlagged = { ...inStock, flagged: false } as const;
  const notPlatform = { ...notFlagged, NOT: { priceSource: "DELIVERY_PLATFORM" }, lastObservedAt: { gte: new Date(Date.now() - 14 * 86_400_000) } } as const;

  const [all, a, b, c, d, e, f] = await Promise.all([
    prisma.offer.count(),
    prisma.offer.count({ where: base }),
    prisma.offer.count({ where: notStale }),
    prisma.offer.count({ where: inStock }),
    prisma.offer.count({ where: notFlagged }),
    prisma.offer.count({ where: notPlatform }),
    prisma.offer.count({ where: { ...notPlatform, product: { section: "grocery" } } }),
  ]);

  return [
    { label: "every offer row", offers: all, removed: 0, why: "" },
    { label: "…at an active merchant", offers: a, removed: all - a, why: "merchant switched off" },
    { label: "…not stale", offers: b, removed: a - b, why: "not seen in the merchant's last feed" },
    { label: "…in stock", offers: c, removed: b - c, why: "the shop says it is out of stock" },
    { label: "…not withheld by a gate", offers: d, removed: c - d, why: "a sanity gate refused it" },
    { label: "…not a delivery platform, seen in 14 days", offers: e, removed: d - e, why: "platform markup, or too old to show" },
    { label: "…in the GROCERY section = the homepage", offers: f, removed: e - f, why: "dcneu, alcohol, farmacie, cosmetice" },
  ];
}

// ── 2. PER-MERCHANT ───────────────────────────────────────────────────────────

export type ProvenanceCoverage = {
  storeName: number;
  ownUnitSize: number;
  rawPriceText: number;
  rawSourceBlob: number;
  productUrl: number;
  /** Products this merchant prices that carry a usable image. See the note in the page. */
  image: number;
  total: number;
};

export type MerchantStat = {
  slug: string;
  name: string;
  active: boolean;
  // ── the last 14 nights, from ScraperRun
  runs: number;
  abortedRuns: number;
  abortReasons: string[];
  /** Pool size on the MOST RECENT non-aborted run. See the note at the summation. */
  pooled: number;
  /** Offer rows that run wrote. Comparable to `pooled` because both are one run. */
  writtenLastRun: number;
  /** Runs in the window that wrote nothing at all and were NOT marked aborted. */
  silentZeroRuns: number;
  parsed: number;
  /**
   * Pool items that reached the matcher without a usable price.
   *
   * READS ZERO IN ALL 149 RUNS EVER RECORDED, and that is a true zero for what it measures —
   * not an unwritten column. `matchPoolToCatalog` computes it as `pool.length - prepared.length`
   * and persists it every run. It is zero because every scraper drops an unparseable price
   * while building its pool, so nothing unreadable ever arrives here.
   *
   * So it is NOT "how many prices we failed to read". That number is not recorded anywhere:
   * it happens inside each scraper, upstream of this counter, and is discarded. Reporting this
   * as a null rate would be presenting a narrow true zero as a broad one.
   */
  unreadableAtMatcher: number;
  written: number;
  /** Catalog products this merchant CREATED in the window. See INSTRUMENTED_SINCE. */
  productsCreated: number;
  refused: number;
  lastSuccessfulWrite: Date | null;
  // ── right now
  offersTotal: number;
  byBucket: Record<string, number>;
  live: number;
  provenance: ProvenanceCoverage;
  // ── matching
  pendingUnresolved: number;
  rejected: number;
  confirmed: number;
};

export async function getMerchantStats(): Promise<MerchantStat[]> {
  const since = new Date(Date.now() - WINDOW_NIGHTS * 86_400_000);
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - STALE_AFTER_DAYS * 86_400_000);

  const merchants = await prisma.merchant.findMany({
    select: { id: true, slug: true, name: true, active: true, lastScrapeAt: true },
    orderBy: { slug: "asc" },
  });

  // ONE query for every offer that has an unresolved anomaly, instead of a correlated
  // `_count` on 52,889 rows. That per-row count was most of the 4.2 s this function took.
  const anomalyRows = await prisma.priceAnomaly.groupBy({
    by: ["offerId"],
    where: { resolved: false, offerId: { not: null } },
    _count: { _all: true },
  });
  const anomaliesByOffer = new Map<number, number>(
    anomalyRows.filter((r) => r.offerId != null).map((r) => [r.offerId as number, r._count._all]),
  );

  // ONE grouped query for provenance coverage. `SUM(CASE WHEN … )` counts non-null columns
  // without transferring a byte of their contents — which matters because `rawSourceBlob`
  // averages 1.4 KB and totals 71 MB. Counting nulls is not a rule anyone can disagree with, so
  // raw SQL here creates no second definition of anything.
  type ProvRow = { merchantId: number; storeName: number; ownUnitSize: number; rawPriceText: number; rawSourceBlob: number; productUrl: number };
  const provRows = await prisma.$queryRawUnsafe<ProvRow[]>(
    `SELECT merchantId,
            SUM(CASE WHEN storeName IS NOT NULL AND storeName <> '' THEN 1 ELSE 0 END) AS storeName,
            SUM(CASE WHEN ownUnitSize IS NOT NULL AND ownUnitSize > 0 THEN 1 ELSE 0 END) AS ownUnitSize,
            SUM(CASE WHEN rawPriceText IS NOT NULL AND rawPriceText <> '' THEN 1 ELSE 0 END) AS rawPriceText,
            SUM(CASE WHEN rawSourceBlob IS NOT NULL AND rawSourceBlob <> '' THEN 1 ELSE 0 END) AS rawSourceBlob,
            SUM(CASE WHEN productUrl IS NOT NULL AND productUrl <> '' THEN 1 ELSE 0 END) AS productUrl
       FROM Offer GROUP BY merchantId`,
  );
  const provenanceByMerchant = new Map(provRows.map((r) => [Number(r.merchantId), r]));

  // Product images, once. One short string per product beats joining 52,889 offer rows.
  const productImage = new Map<number, string | null>(
    (await prisma.product.findMany({ select: { id: true, image: true } })).map((p) => [p.id, p.image]),
  );

  // ONE PASS OVER THE OFFERS, grouped here. This was one query per merchant inside the loop —
  // fourteen scans of the same table for a table that reports on scans. Same fix, same reason,
  // as the sidebar that ran 85 counts a page load.
  type BucketOffer = {
    id: number; productId: number; merchantId: number;
    flagged: boolean; isExpired: boolean; promoValidTo: Date | null; isStale: boolean;
    lastObservedAt: Date | null; priceSource: string | null; availability: string;
    stockStatus: string; vatBasis: string;
  };
  const allOffers = await prisma.offer.findMany({
    select: {
      id: true, productId: true, merchantId: true,
      flagged: true, isExpired: true, promoValidTo: true, isStale: true, lastObservedAt: true,
      priceSource: true, availability: true, stockStatus: true, vatBasis: true,
    },
  });
  const offersByMerchant = new Map<number, BucketOffer[]>();
  for (const o of allOffers) {
    const list = offersByMerchant.get(o.merchantId);
    if (list) list.push(o); else offersByMerchant.set(o.merchantId, [o]);
  }

  const out: MerchantStat[] = [];
  for (const m of merchants) {
    const runs = await prisma.scraperRun.findMany({
      where: { merchantId: m.id, startedAt: { gte: since } },
      select: {
        offersAttempted: true, offersParsed: true, offersNull: true, offersRejected: true,
        offersWritten: true, productsCreated: true, aborted: true, abortReason: true, finishedAt: true, startedAt: true,
      },
      orderBy: { startedAt: "desc" },
    });

    // ── POOLED IS ONE RUN, NOT FOURTEEN SUMMED.
    //
    // This summed `offersAttempted` across the window and printed it beside the summed
    // `offersWritten`. For Mega Image that read "91,973 pooled, 4,395 written" — a 4.8% write
    // rate that does not exist. They are fourteen separate runs over THE SAME catalog: ~7,030
    // pooled each time, ~741 written each time. Dividing one sum by the other invents a ratio
    // out of two numbers that are not a ratio, and it sent a reader hunting a scraper bug that
    // was not there.
    //
    // So `pooled` and `writtenLastRun` come from the most recent run that actually ran, and
    // those two ARE comparable. `written` stays the window sum, labelled as a sum.
    //
    // Even within one run they are not a clean ratio: `offersWritten` counts offer ROWS,
    // including ones re-activated from an earlier run, so kaufland pooled 247 and wrote 280.
    const lastReal = runs.find((r) => !r.aborted && r.offersAttempted > 0);
    const pooled = lastReal?.offersAttempted ?? 0;
    const writtenLastRun = lastReal?.offersWritten ?? 0;
    // A run that wrote nothing and was NOT flagged aborted would be a real ledger gap — the
    // Penny defect at a second address. SCOPED TO RUNS THAT COULD HAVE CARRIED THE FLAG.
    //
    // `recordScraperRun` has derived `aborted` from `offersWritten === 0` since 533fae2 on
    // 2026-09-02. Every one of the 46 rows in the database with `written = 0, aborted = false`
    // was recorded BEFORE that; zero since. Counting them as a live failure — which the first
    // version of this column did, and reported seven against Mega Image — is treating rows
    // written before the instrumentation as though they had been measured by it. That is the
    // defect this project keeps meeting, in the page built to report on it, for the second time
    // in one sitting.
    const silentZeroRuns = runs.filter(
      (r) => !r.aborted && r.offersAttempted > 0 && r.offersWritten === 0 && r.startedAt >= ABORT_GUARD_LANDED,
    ).length;
    const parsed = runs.reduce((s, r) => s + r.offersParsed, 0);
    const unreadableAtMatcher = runs.reduce((s, r) => s + r.offersNull, 0);
    const aborted = runs.filter((r) => r.aborted);
    const lastGood = runs.find((r) => !r.aborted && r.offersWritten > 0);

    // Every offer this merchant holds, bucketed by the ONE reason it is not shown. Same
    // classifier the census and the nightly use — a second definition of "live" here is how a
    // stats page starts disagreeing with the site it describes.
    //
    // CHEAP COLUMNS ONLY. Selecting `rawSourceBlob` to check whether it is null pulled 71 MB of
    // source payloads through the ORM to answer a yes/no question, and took this function from
    // 1.0 s to 4.2 s. The provenance counts come from one grouped SQL query instead (below),
    // which never transfers the blob at all. Exactly the mistake Brief 1 found on /oferte,
    // repeated in the page built to report on it.
    const offers = offersByMerchant.get(m.id) ?? [];
    const scrapedRecently = m.lastScrapeAt != null && m.lastScrapeAt >= staleCutoff;
    const byBucket: Record<string, number> = {};
    for (const b of BUCKETS) byBucket[b] = 0;
    let imagesUsable = 0;
    for (const o of offers) {
      const row: CensusRow = {
        merchantActive: m.active,
        merchantScrapedRecently: scrapedRecently,
        anomalies: anomaliesByOffer.get(o.id) ?? 0,
        flagged: o.flagged,
        isExpired: o.isExpired,
        promoValidTo: o.promoValidTo,
        isStale: o.isStale,
        lastObservedAt: o.lastObservedAt,
        priceSource: o.priceSource,
        availability: o.availability,
        stockStatus: o.stockStatus,
        vatBasis: o.vatBasis,
      };
      byBucket[classifyOffer(row, now) as Bucket]++;
      // `isPlaceholderImage` stays in JavaScript: it is a substring list, and re-expressing it
      // in SQL would be a second definition of "usable image" for the renderer to disagree with.
      if (!isPlaceholderImage(productImage.get(o.productId) ?? null)) imagesUsable++;
    }
    const cov = provenanceByMerchant.get(m.id);
    const prov: ProvenanceCoverage = {
      storeName: Number(cov?.storeName ?? 0),
      ownUnitSize: Number(cov?.ownUnitSize ?? 0),
      rawPriceText: Number(cov?.rawPriceText ?? 0),
      rawSourceBlob: Number(cov?.rawSourceBlob ?? 0),
      productUrl: Number(cov?.productUrl ?? 0),
      image: imagesUsable,
      total: offers.length,
    };

    // TWO TABLES RECORD A HUMAN DECISION, AND THEY ARE NOT THE SAME TABLE.
    //
    // `PendingMatch.decision` is the review queue's own column: null on all 62,709 rows,
    // because nobody has worked the queue yet. `MatchOverride` is where a decision that BINDS
    // lives — CLAUDE.md: "Human decisions in MatchOverride always win and must survive a full
    // catalog rebuild" — and it holds 5 rejects.
    //
    // Reading rejections from PendingMatch would have printed 0 for every merchant while five
    // real rejects were in force. One question, two columns, and only one of them authoritative:
    // the queue is counted from the queue, the decisions from the overrides.
    const [pendingUnresolved, rejected, confirmed] = await Promise.all([
      prisma.pendingMatch.count({ where: { merchantId: m.id, resolved: false } }),
      prisma.matchOverride.count({ where: { merchantId: m.id, decision: "reject" } }),
      prisma.matchOverride.count({ where: { merchantId: m.id, decision: "confirm" } }),
    ]);

    out.push({
      slug: m.slug, name: m.name, active: m.active,
      runs: runs.length,
      abortedRuns: aborted.length,
      abortReasons: [...new Set(aborted.map((a) => a.abortReason ?? "(no reason recorded)"))].slice(0, 3),
      pooled, writtenLastRun, silentZeroRuns, parsed, unreadableAtMatcher,
      written: runs.reduce((s, r) => s + r.offersWritten, 0),
      productsCreated: runs.reduce((s, r) => s + r.productsCreated, 0),
      refused: runs.reduce((s, r) => s + r.offersRejected, 0),
      lastSuccessfulWrite: lastGood?.finishedAt ?? lastGood?.startedAt ?? null,
      offersTotal: offers.length,
      byBucket,
      live: byBucket["live"] ?? 0,
      provenance: prov,
      pendingUnresolved, rejected, confirmed,
    });
  }
  return out;
}

// ── 3. THE GAP ────────────────────────────────────────────────────────────────

export type GapRow = { merchant: string; reason: string; count: number; medianScore: number };

/**
 * Pooled products that matched nothing, grouped by why.
 *
 * This is the table that says where matching effort would pay. A reason appearing 2,000 times
 * for one merchant is a rule to fix; the same reason spread thinly across all of them is the
 * matcher behaving as designed.
 *
 * ONLY UNRESOLVED ROWS. A rejected pairing is a decision somebody made, not a gap — counting
 * those here would make the queue look like a backlog that grows every time it is worked.
 */
export async function getGapAnalysis(): Promise<GapRow[]> {
  const rows = await prisma.pendingMatch.findMany({
    where: { resolved: false },
    select: { reason: true, score: true, merchant: { select: { slug: true } } },
  });
  const grouped = new Map<string, { merchant: string; reason: string; scores: number[] }>();
  for (const r of rows) {
    const key = `${r.merchant.slug}::${r.reason}`;
    const g = grouped.get(key) ?? { merchant: r.merchant.slug, reason: r.reason, scores: [] };
    g.scores.push(r.score);
    grouped.set(key, g);
  }
  return [...grouped.values()]
    .map((g) => {
      const sorted = [...g.scores].sort((a, b) => a - b);
      return {
        merchant: g.merchant,
        reason: g.reason,
        count: g.scores.length,
        medianScore: sorted[Math.floor(sorted.length / 2)] ?? 0,
      };
    })
    .sort((a, b) => b.count - a.count);
}
