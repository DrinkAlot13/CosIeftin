// Withhold every VISIBLE offer that sits more than 70% from its product's cross-store median.
//
// The rule and the population both come from `lib/outlier`, which `audit-db` also imports.
// They previously carried separate copies — two thresholds over two populations — so the
// audit reported 47 and the repair found 7, and the gap looked like a bug in one rather than
// a disagreement between them. That is the `priceSource` shape, and it is why this file
// defines nothing of its own.
//
// Also DIAGNOSES what these actually are. A price 70% from its peers is nearly always a wrong
// match, and the suspected shape is a multipack matched onto a single: Auchan water at 19,95
// against a 4,20 median is a six-pack on a single-bottle product. If that is the bulk of them,
// the pack-shape gate is not reaching these rows — most likely because they carry no
// `ownUnitSize`, which is exactly the provenance a re-scrape fills in.
//
// Dry run:  npm run withhold:outliers
// Apply:    npm run withhold:outliers -- --apply

import { PrismaClient } from "@prisma/client";
import { findOutliers, baniOf, MEDIAN_DEVIATION, MIN_OFFERS_FOR_MEDIAN } from "../src/lib/outlier";
import { parseQuantity } from "../src/lib/units/parseQuantity";
import { recordRefusal } from "../src/lib/record-refusal";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const lei = (b: number): string => (b / 100).toFixed(2);
const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));

async function main(): Promise<void> {
  const offers = await prisma.offer.findMany({
    where: { merchant: { active: true } },
    select: {
      id: true, productId: true, price: true, priceBani: true, flagged: true, isStale: true,
      availability: true, storeName: true, ownUnitSize: true, ownUnit: true, merchantId: true,
      merchant: { select: { slug: true } },
      product: { select: { name: true, unitSize: true, unit: true } },
    },
  });
  const byProduct = new Map<number, typeof offers>();
  for (const o of offers) {
    const a = byProduct.get(o.productId) ?? [];
    a.push(o);
    byProduct.set(o.productId, a);
  }
  const found = findOutliers(byProduct);

  console.log(`\n════ VISIBLE OFFERS >${MEDIAN_DEVIATION * 100}% FROM THEIR CROSS-STORE MEDIAN ════════`);
  console.log(`  definition and population both from lib/outlier, shared with audit-db`);
  console.log(`  (median over VISIBLE offers only, minimum ${MIN_OFFERS_FOR_MEDIAN} peers)\n`);
  console.log(`  found: ${found.length}`);

  // ── DIAGNOSIS. Is this a multipack matched onto a single?
  let packMismatch = 0;
  let noOwnSize = 0;
  let other = 0;
  for (const f of found) {
    const o = f.offer;
    const ownPack = o.storeName ? parseQuantity(o.storeName)?.packCount ?? 1 : null;
    const catPack = parseQuantity(o.product.name)?.packCount ?? 1;
    if (o.ownUnitSize == null) { noOwnSize++; continue; }
    if (ownPack != null && ownPack !== catPack) { packMismatch++; continue; }
    other++;
  }
  console.log(`\n  WHY THEY GOT PAST THE GATE:`);
  console.log(`    no ownUnitSize recorded (pack shape unknowable):  ${noOwnSize}`);
  console.log(`    pack shape differs from the catalog product:      ${packMismatch}`);
  console.log(`    neither — a genuine price disagreement:           ${other}`);

  console.log(`\n  WORST 20 (both values):`);
  const worst = [...found].sort((a, b) =>
    Math.abs(baniOf(b.offer) - b.medianBani) / b.medianBani - Math.abs(baniOf(a.offer) - a.medianBani) / a.medianBani,
  );
  for (const f of worst.slice(0, 20)) {
    const o = f.offer;
    const ratio = baniOf(o) / f.medianBani;
    console.log(
      `    ${ratio.toFixed(2)}x  ${pad(o.merchant.slug, 12)} ${lei(baniOf(o)).padStart(9)} vs median ${lei(f.medianBani).padStart(9)}` +
      `  own=${o.ownUnitSize ?? "null"}${o.ownUnit ?? ""}  ${o.product.name.slice(0, 34)}`,
    );
  }

  if (!APPLY) {
    console.log(`\n  DRY RUN — nothing written. Re-run with --apply.\n`);
    await prisma.$disconnect();
    return;
  }

  for (const f of found) {
    const o = f.offer;
    await prisma.offer.update({
      where: { id: o.id },
      data: {
        flagged: true,
        flagReason:
          `withheld: ${lei(baniOf(o))} is more than ${MEDIAN_DEVIATION * 100}% from this product's ` +
          `cross-store median ${lei(f.medianBani)} across ${f.peers} shops — a wrong match or a wrong price`,
      },
    });
    await recordRefusal({
      offerId: o.id, merchantId: o.merchantId,
      storeName: o.storeName ?? o.product.name,
      rejectedPriceBani: baniOf(o), acceptedPriceBani: null, rawPriceText: null,
      reason: `outlier vs cross-store median ${lei(f.medianBani)} of ${f.peers} shops`,
    });
  }
  console.log(`\n  withheld ${found.length} offer(s), each with its refusal recorded. Nothing deleted.`);
  console.log(`  This script has NOT verified its own work. Run: npm run audit:db\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
