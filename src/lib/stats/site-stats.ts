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
  pooled: number;
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
        offersWritten: true, aborted: true, abortReason: true, finishedAt: true, startedAt: true,
      },
      orderBy: { startedAt: "desc" },
    });

    // `offersAttempted` counts pool items this run; `offersWritten` counts offer ROWS written,
    // which includes rows re-activated from an earlier run. They are not a ratio: kaufland
    // pooled 247 and wrote 280, farmaciatei pooled 807 and wrote 1,143. Printed side by side
    // and never divided.
    const pooled = runs.reduce((s, r) => s + r.offersAttempted, 0);
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
      pooled, parsed, unreadableAtMatcher,
      written: runs.reduce((s, r) => s + r.offersWritten, 0),
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
