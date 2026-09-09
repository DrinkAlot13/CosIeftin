// ── WHAT DID ADDING THIS SHOP ACTUALLY BUY US? READ-ONLY.
//
// The tempting number after adding a merchant is its offer count, and it is the wrong one. A
// shop contributes to THIS site only when it puts a SECOND price beside a product that already
// had one. A shop that brings 700 offers, all of them products nobody else sells, has added 700
// rows and zero comparisons.
//
// So this asks the counterfactual directly: for each merchant, how many products would STOP
// being comparable if that merchant vanished. That is its contribution, and it is usually far
// smaller than its offer count.
//
//   npm run audit:merchant-contribution
//   SHOW_DELIVERY_PLATFORM=1 npm run audit:merchant-contribution

import { PrismaClient } from "@prisma/client";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();
const MAX_AGE = 14 * 86_400_000;

async function main(): Promise<void> {
  const showPlatform = ["1", "true", "yes"].includes((process.env.SHOW_DELIVERY_PLATFORM ?? "").toLowerCase());
  const cutoff = new Date(Date.now() - MAX_AGE);

  const offers = await prisma.offer.findMany({
    where: {
      merchant: { active: true }, isStale: false, flagged: false,
      availability: "in stock", lastObservedAt: { gte: cutoff },
      ...(showPlatform ? {} : { priceSource: { not: "DELIVERY_PLATFORM" } }),
    },
    select: { productId: true, merchant: { select: { slug: true } }, product: { select: { section: true } } },
  });

  // productId -> the set of merchants showing it
  const byProduct = new Map<number, Set<string>>();
  const sectionOf = new Map<number, string>();
  for (const o of offers) {
    let s = byProduct.get(o.productId);
    if (!s) byProduct.set(o.productId, (s = new Set()));
    s.add(o.merchant.slug);
    sectionOf.set(o.productId, o.product.section);
  }

  const comparable = [...byProduct.values()].filter((s) => s.size >= 2).length;

  type Row = { merchant: string; offers: number; products: number; soleSecond: number; onlyShop: number };
  const per = new Map<string, Row>();
  const bump = (slug: string): Row => {
    let r = per.get(slug);
    if (!r) per.set(slug, (r = { merchant: slug, offers: 0, products: 0, soleSecond: 0, onlyShop: 0 }));
    return r;
  };
  for (const o of offers) bump(o.merchant.slug).offers++;

  for (const [pid, merchants] of byProduct) {
    for (const m of merchants) {
      const r = bump(m);
      r.products++;
      // WITHOUT this merchant, would the product still be comparable?
      if (merchants.size === 2) r.soleSecond++;   // it is the reason this product compares at all
      if (merchants.size === 1) r.onlyShop++;     // it contributes a price, never a comparison
    }
    void pid;
  }

  console.log("═".repeat(104));
  console.log(`MERCHANT CONTRIBUTION — how many comparisons would vanish with this shop`);
  console.log(`delivery-platform prices: ${showPlatform ? "INCLUDED (toggle on)" : "excluded (default)"}`);
  console.log("═".repeat(104));
  console.log(`  products with a showable price   ${byProduct.size}`);
  console.log(`  COMPARABLE (2+ merchants)        ${comparable}   ${((comparable / Math.max(1, byProduct.size)) * 100).toFixed(1)}%`);

  console.log(`\n  ${"merchant".padEnd(18)} ${"offers".padStart(8)} ${"products".padStart(9)} ${"SOLE 2nd".padStart(9)} ${"only shop".padStart(10)}  what it buys`);
  const rows = [...per.values()].sort((a, b) => b.soleSecond - a.soleSecond);
  for (const r of rows) {
    const verdict = r.soleSecond === 0
      ? "NO comparisons depend on it"
      : `${r.soleSecond} product(s) compare ONLY because of it`;
    console.log(`  ${r.merchant.padEnd(18)} ${String(r.offers).padStart(8)} ${String(r.products).padStart(9)} ${String(r.soleSecond).padStart(9)} ${String(r.onlyShop).padStart(10)}  ${verdict}`);
  }

  console.log(`\n  SOLE 2nd = products where this merchant is one of exactly TWO. Remove the shop and`);
  console.log(`  those products stop being comparable. It is the honest measure of what a shop adds,`);
  console.log(`  and it is not the offer count.`);

  emitJson({
    showPlatform, productsWithPrice: byProduct.size, comparable,
    merchants: rows, pass: true,
  });
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
