// Comparability, with the denominator settled.
//
// THE DENOMINATOR IS "PRODUCTS WITH AT LEAST ONE VISIBLE PRICE TODAY" (18,316), not "products
// in scope" (24,361). Both were defensible and having two was the problem — `audit:comparability`
// divided by one and every ad-hoc query divided by the other, so the same catalog was 8.1% and
// 10.8% depending on who asked.
//
// Why this one:
//
//   A product nobody prices today is a COVERAGE failure, not a comparability failure. Folding
//   it into this ratio makes the number move whenever coverage moves and hides which of the two
//   actually changed — a scraper going dark would "improve" comparability by shrinking the
//   denominator, which is exactly backwards.
//
//   So the two are reported side by side and never multiplied together: coverage says how much
//   of the catalog has a price at all, comparability says how much of THAT can be compared.
//
// Stated in /metodologie in those words, so the site and this file cannot drift.

import { prisma } from "./db";
import { currentOfferWhere } from "./queries";
import { INDEX_BASKET } from "./index-basket";

export type Spread = {
  total: number;
  atLeast2: number;
  atLeast3: number;
  atLeast4: number;
  share2: number;
};

function spread(counts: number[]): Spread {
  const total = counts.length;
  const at = (k: number) => counts.filter((c) => c >= k).length;
  return {
    total,
    atLeast2: at(2),
    atLeast3: at(3),
    atLeast4: at(4),
    share2: total ? (at(2) / total) * 100 : 0,
  };
}

export type ComparabilityReport = {
  /** The 40 pinned staples — what a shopper actually buys. */
  basket: Spread;
  /** Every grocery product with a visible price today. */
  catalog: Spread;
  /** Products in scope that have no visible price at all — reported, never folded in. */
  unpriced: number;
  inScope: number;
};

/**
 * Merchants-per-product, over offers a shopper can see today.
 *
 * One pass over the offers rather than a count per product: at 20k offers the per-product
 * version was 18,316 queries and took long enough that /admin/health felt broken.
 */
export async function getComparability(): Promise<ComparabilityReport> {
  const live = currentOfferWhere();
  const rows = await prisma.offer.findMany({
    where: { ...live, product: { section: "grocery" } },
    select: { productId: true, merchantId: true },
  });
  const byProduct = new Map<number, Set<number>>();
  for (const r of rows) {
    const s = byProduct.get(r.productId) ?? new Set<number>();
    s.add(r.merchantId);
    byProduct.set(r.productId, s);
  }

  const catalog = spread([...byProduct.values()].map((s) => s.size));

  const pinned = await prisma.product.findMany({
    where: { slug: { in: INDEX_BASKET.map((b) => b.slug) } },
    select: { id: true },
  });
  // A pin that resolves to no live offer counts as 0 merchants rather than being dropped: the
  // basket is a fixed list of 40 things, and quietly shrinking it when one goes unpriced would
  // flatter the number exactly when it should fall.
  const basket = spread(pinned.map((p) => byProduct.get(p.id)?.size ?? 0));

  const inScope = await prisma.product.count({ where: { section: "grocery" } });
  return { basket, catalog, unpriced: inScope - catalog.total, inScope };
}
