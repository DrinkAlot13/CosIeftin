// Withhold five offers that are matched onto the wrong catalog product, and record the
// decision so it survives a re-scrape.
//
// FOUND BY the >70%-from-median invariant — but NOT in the way that invariant reads. It flagged
// Carrefour's gelatine at 5,79 against a 1,59 median and Sezamo's mici at 35,50 against 17,99,
// i.e. it named the EXPENSIVE row in each case. The expensive rows are the correct ones. The
// medians are wrong, because each is computed over a set that contains false matches:
//
//   #2971  "Gelatina foi Dr. Oetker 10 g"
//          Auchan 6,85 matched by EAN, exact name.        <- authoritative
//          Carrefour 5,79, exact name "Foi de gelatina Dr.Oetker 10 g".
//          Sezamo 1,59 from "Dr.Oetker Gelatina" — no format, no size. Dr. Oetker sells
//            gelatine as SHEETS and as POWDER, and 1,59 is the powder price.
//          Freshful 1,49 with matchedBy="scraper" and no source payload at all.
//          Mega Image 1,49 at score 0.70, its payload carrying only a category string.
//
//   #14147 "CARNE SI SARE Mici porc vita oaie cca 0,53 kg"
//          Sezamo 35,50 IS that product (its own payload says "cca 0,51 kg", 69,90 lei/kg).
//          Freshful 17,48 is "Mici din carne de porc și vită 500g" — a different, unbranded
//            product, matched at 0.67 on name+size with zero overlap on the brand token.
//          Mega Image 17,99 at 0.67, payload carrying only "Mezeluri, carne si ready meal".
//
// That is the Zarea "Sânge de Taur" failure again: head noun plus size is a product FAMILY, and
// a branded artisanal item and a supermarket own-label are not the same thing at 34 vs 70 lei/kg.
//
// WHY THE MEDIAN MATTERS. An invariant that compares a row against the median of its peers
// assumes the peers are peers. When false matches cluster — three of five here — the median
// moves to the false cluster and the invariant indicts the correct row. It is still a useful
// alarm; it just does not say which side is wrong, and reading it as "the flagged row is bad"
// would have withheld the two prices that are right.
//
// WHAT THIS DOES: flags the five offers (withhold, never delete) and writes a `reject`
// MatchOverride keyed on (merchantId, slugify(storeName)) so a re-scrape cannot silently
// re-create the pairing. Human decisions must survive a catalog rebuild.
//
// Run: npx tsx scripts/withhold-false-matches.ts [--apply]

import { prisma } from "../src/lib/db";
import { slugify } from "../src/lib/scrape-util";

/** (merchant slug, catalog product id) pairs that are not the same product. */
const WRONG: { merchant: string; productId: number; why: string }[] = [
  { merchant: "freshful", productId: 2971, why: "no source payload; 1,49 is the powder, not the 10 g sheets Auchan confirms by EAN at 6,85" },
  { merchant: "mega-image", productId: 2971, why: "store name is \"Gelatina 10g\" — no brand and no format; 1,49 is the powder, not the 10 g sheets" },
  { merchant: "sezamo", productId: 2971, why: "store name is \"Dr.Oetker Gelatina\" — brand but no format, and Dr. Oetker sells both sheets and powder; 1,59 is the powder" },
  { merchant: "freshful", productId: 14147, why: "store name is \"Mici din carne de porc și vită 500g\" — unbranded, no overlap with CARNE SI SARE" },
  { merchant: "mega-image", productId: 14147, why: "score 0.67, payload carries only a category; 34 lei/kg is own-label, the product is 70 lei/kg artisanal" },
];

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  console.log(`\n════ WITHHOLD FALSE MATCHES ${apply ? "" : "(DRY RUN)"} ═══════════════════════════════\n`);

  for (const w of WRONG) {
    const m = await prisma.merchant.findUnique({ where: { slug: w.merchant }, select: { id: true, name: true } });
    if (!m) { console.log(`  ${w.merchant}: no such merchant`); continue; }
    const offer = await prisma.offer.findFirst({
      where: { merchantId: m.id, productId: w.productId },
      select: { id: true, price: true, storeName: true, flagged: true, product: { select: { name: true } } },
    });
    if (!offer) { console.log(`  ${m.name} × #${w.productId}: no offer (already gone)`); continue; }

    // The key the matcher will look this store product up by on the next run.
    const storeKey = slugify(offer.storeName ?? "") || `product-${w.productId}`;
    console.log(`  ${m.name.padEnd(12)} offer ${String(offer.id).padStart(6)}  ${String(offer.price).padStart(7)}  -> "${offer.product.name.slice(0, 46)}"`);
    console.log(`     storeName "${offer.storeName ?? "(none)"}" -> storeKey "${storeKey}"`);
    console.log(`     ${w.why}`);
    if (!offer.storeName) {
      console.log(`     ⚠ no storeName recorded, so the override key is a fallback — the flag holds, the override may not.`);
    }

    if (!apply) { console.log(); continue; }

    await prisma.offer.update({
      where: { id: offer.id },
      data: { flagged: true, flagReason: `false match — ${w.why}`.slice(0, 240) },
    });
    await prisma.matchOverride.upsert({
      where: { merchantId_storeKey: { merchantId: m.id, storeKey } },
      update: { productId: w.productId, decision: "reject", note: w.why.slice(0, 240) },
      create: { merchantId: m.id, storeKey, productId: w.productId, decision: "reject", note: w.why.slice(0, 240) },
    });
    console.log(`     ✓ withheld and rejected\n`);
  }

  if (!apply) console.log(`  DRY RUN — nothing written. Re-run with --apply.\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
