// The review queue: which PENDING matches are worth a human's attention, and in what order.
//
// The point of ranking is that these are not equal. A pending match that would take a product
// from ONE merchant to TWO creates a comparison where none existed — that is the entire
// product. One that takes a product from four merchants to five adds a row to a table someone
// is already able to use. With ~3,300 of these, reviewing them in database order would spend
// the first evening on the least valuable half.
//
// So value is: does this create a comparison, and how much money is at stake if it does.

import { prisma } from "./db";

export type PendingCandidate = {
  id: number;
  productId: number;
  productName: string;
  productSlug: string;
  productImage: string | null;
  productBrand: string | null;
  /** cheapest live offer on the catalog side, for a like-for-like price comparison */
  catalogPriceBani: number | null;
  catalogMerchants: string[];

  merchantSlug: string;
  merchantName: string;
  storeKey: string;
  storeName: string;
  storeBrand: string | null;
  storePriceBani: number;
  storeUrl: string | null;
  storeImage: string | null;

  score: number;
  reason: string;
  section: string;

  /** merchants the product has now; approving this adds one if the merchant is new */
  merchantsNow: number;
  /** true when approving turns "no comparison" into "a comparison" */
  createsComparison: boolean;
  /** |store price - catalog cheapest| in bani; how much the shopper could be wrong by */
  spreadBani: number | null;
  /** the ordering key — see rankValue */
  value: number;
};

/**
 * How much this decision is worth.
 *
 * Dominated by whether it creates a comparison at all: going 1 -> 2 merchants is the product
 * working for the first time on that item, and nothing else in the ranking should outrank it.
 * Within that, a wider price spread matters more — a 2 lei difference is a rounding error to a
 * shopper, a 20 lei one is the reason they came.
 */
export function rankValue(input: { merchantsNow: number; createsComparison: boolean; spreadBani: number | null; score: number }): number {
  const comparison = input.createsComparison ? 1000 : 0;
  // Diminishing: the 2nd merchant is transformative, the 6th is a row in a table.
  const breadth = 200 / (input.merchantsNow + 1);
  const spread = Math.min((input.spreadBani ?? 0) / 100, 100); // lei, capped so one outlier cannot own the queue
  // Confidence breaks ties only. A high-scoring match that changes nothing is still worth less
  // than a lower-scoring one that creates a comparison.
  return comparison + breadth + spread + input.score * 10;
}

/** Load the queue, ranked. `merchant` and `section` narrow it; `limit` bounds the page. */
export async function loadPendingQueue(opts: { limit?: number; merchant?: string; section?: string } = {}): Promise<PendingCandidate[]> {
  const rows = await prisma.pendingMatch.findMany({
    where: {
      resolved: false,
      ...(opts.merchant ? { merchant: { slug: opts.merchant } } : {}),
      ...(opts.section ? { section: opts.section } : {}),
    },
    include: {
      merchant: { select: { slug: true, name: true } },
      product: {
        select: {
          id: true, name: true, slug: true, image: true, brand: true,
          offers: {
            where: { isStale: false, merchant: { active: true } },
            select: { priceBani: true, price: true, merchant: { select: { slug: true, name: true } } },
          },
        },
      },
    },
    // A generous first cut; the real ordering is computed below and cannot be expressed in SQL.
    orderBy: { score: "desc" },
    take: Math.max(opts.limit ?? 200, 200) * 6,
  });

  const out: PendingCandidate[] = rows.map((r) => {
    const live = r.product.offers;
    const merchants = [...new Set(live.map((o) => o.merchant.slug))];
    const prices = live.map((o) => o.priceBani ?? Math.round(o.price * 100)).filter((n) => n > 0);
    const catalogPriceBani = prices.length ? Math.min(...prices) : null;
    const alreadyHere = merchants.includes(r.merchant.slug);
    const merchantsNow = merchants.length;
    // Approving only adds breadth if this merchant is not already on the product.
    const createsComparison = !alreadyHere && merchantsNow === 1;
    const spreadBani = catalogPriceBani == null ? null : Math.abs(r.storePriceBani - catalogPriceBani);

    return {
      id: r.id,
      productId: r.productId,
      productName: r.product.name,
      productSlug: r.product.slug,
      productImage: r.product.image,
      productBrand: r.product.brand,
      catalogPriceBani,
      catalogMerchants: live.map((o) => o.merchant.name),
      merchantSlug: r.merchant.slug,
      merchantName: r.merchant.name,
      storeKey: r.storeKey,
      storeName: r.storeName,
      storeBrand: r.storeBrand,
      storePriceBani: r.storePriceBani,
      storeUrl: r.storeUrl,
      storeImage: r.storeImage,
      score: r.score,
      reason: r.reason,
      section: r.section,
      merchantsNow,
      createsComparison,
      spreadBani,
      value: rankValue({ merchantsNow, createsComparison, spreadBani, score: r.score }),
    };
  });

  out.sort((a, b) => b.value - a.value);
  return out.slice(0, opts.limit ?? 200);
}

/**
 * What the merchants-per-product distribution WOULD become if every pending match were
 * approved. This is the number that decides whether reviewing them is worth an evening.
 *
 * It is an upper bound and says so: it assumes every single one is correct, which they are not.
 */
export async function pendingUpperBound(): Promise<{
  before: Map<number, number>;
  after: Map<number, number>;
  productsGainingAMerchant: number;
  comparableBefore: number;
  comparableAfter: number;
  liveProducts: number;
  pendingTotal: number;
}> {
  // Exclude dcneu: it has one merchant and no peer, so it can never be comparable and
  // including it only drags the metric down with something no matcher can fix.
  const products = await prisma.product.findMany({
    where: { section: { not: "dcneu" }, offers: { some: { isStale: false, merchant: { active: true } } } },
    select: {
      id: true,
      offers: { where: { isStale: false, merchant: { active: true } }, select: { merchantId: true } },
      pendingMatches: { where: { resolved: false }, select: { merchantId: true } },
    },
  });

  const before = new Map<number, number>();
  const after = new Map<number, number>();
  let gaining = 0;
  let comparableBefore = 0;
  let comparableAfter = 0;

  for (const p of products) {
    const now = new Set(p.offers.map((o) => o.merchantId));
    const merged = new Set(now);
    for (const pm of p.pendingMatches) merged.add(pm.merchantId);

    before.set(now.size, (before.get(now.size) ?? 0) + 1);
    after.set(merged.size, (after.get(merged.size) ?? 0) + 1);
    if (merged.size > now.size) gaining++;
    if (now.size >= 2) comparableBefore++;
    if (merged.size >= 2) comparableAfter++;
  }

  const pendingTotal = await prisma.pendingMatch.count({ where: { resolved: false } });
  return { before, after, productsGainingAMerchant: gaining, comparableBefore, comparableAfter, liveProducts: products.length, pendingTotal };
}
