// Repair the 129 rows whose rawPriceText belongs to a price we refused.
//
// When a sanity gate refused a price, the shared write path kept the previously trusted value
// and overwrote `rawPriceText` with the REFUSED string anyway. The row then claimed a source
// it did not come from. Every one of the 129 rows in the catalog that cannot reproduce from
// its own source string is such a row — 129 of the 130 flagged offers in the database.
//
// The write path is fixed. This repairs what it already wrote.
//
// NOTHING IS DISCARDED. The refused string is the evidence of what the page said at the time,
// so it moves into PriceAnomaly (refused value, kept value, source string, reason) BEFORE the
// column is cleared. Only then does rawPriceText become null — null being the honest answer
// to "what string produced this price", which we no longer know.
//
// This script does not verify its own work. `audit-db` carries the invariant
// "every stored price reproduces from its own rawPriceText".
//
// Dry run:  npm run repair:flagged-provenance
// Apply:    npm run repair:flagged-provenance -- --apply

import { PrismaClient } from "@prisma/client";
import { parsePrice } from "../src/lib/price/parsePrice";
import { recordRefusal } from "../src/lib/record-refusal";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main(): Promise<void> {
  const offers = await prisma.offer.findMany({
    where: { rawPriceText: { not: null } },
    select: {
      id: true, price: true, priceBani: true, rawPriceText: true, flagged: true, flagReason: true,
      merchantId: true, storeName: true,
      merchant: { select: { slug: true } },
      product: { select: { name: true } },
    },
  });

  type Target = { id: number; merchantId: number; storeName: string | null; kept: number; refused: number; raw: string; reason: string; slug: string; name: string };
  const targets: Target[] = [];
  for (const o of offers) {
    const kept = o.priceBani ?? Math.round(o.price * 100);
    const refused = parsePrice(o.rawPriceText ?? "");
    if (refused == null || Math.abs(refused - kept) <= 1) continue;
    targets.push({
      id: o.id, merchantId: o.merchantId, storeName: o.storeName,
      kept, refused, raw: o.rawPriceText!, slug: o.merchant.slug, name: o.product.name,
      reason: o.flagReason ?? "refused by a sanity gate (reason not recorded at the time)",
    });
  }

  console.log(`\nRows whose rawPriceText belongs to a REFUSED price: ${targets.length}`);
  const byMerchant = new Map<string, number>();
  const flaggedCount = targets.filter((t) => offers.find((o) => o.id === t.id)?.flagged).length;
  for (const t of targets) byMerchant.set(t.slug, (byMerchant.get(t.slug) ?? 0) + 1);
  console.log(`  of which flagged: ${flaggedCount} (a non-flagged one would mean a DIFFERENT bug)`);
  console.log(`  by merchant: ${[...byMerchant.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  ")}`);
  console.log(`\n  first 10:`);
  for (const t of targets.slice(0, 10)) {
    console.log(
      `    offer ${String(t.id).padStart(6)} [${t.slug.padEnd(11)}] keeps ${(t.kept / 100).toFixed(2).padStart(8)} ` +
      `but says ${JSON.stringify(t.raw)} (${(t.refused / 100).toFixed(2)})  ${t.name.slice(0, 34)}`,
    );
  }

  // How many already have the refusal recorded? Anything scraped since the gates started
  // recording will; the historical ones will not.
  const already = await prisma.priceAnomaly.findMany({
    where: { offerId: { in: targets.map((t) => t.id) } },
    select: { offerId: true, rejectedPriceBani: true },
  });
  const haveRecord = new Set(already.filter((a) => a.rejectedPriceBani > 0).map((a) => a.offerId));
  console.log(`\n  refusals already recorded in PriceAnomaly: ${haveRecord.size}`);
  console.log(`  refusals that would be recorded now:       ${targets.length - haveRecord.size}`);

  if (!APPLY) {
    console.log(`\n  DRY RUN — nothing written. Re-run with --apply.\n`);
    await prisma.$disconnect();
    return;
  }

  let recorded = 0;
  let cleared = 0;
  for (const t of targets) {
    if (!haveRecord.has(t.id)) {
      // Through recordRefusal, not a direct create. `tests/gates-defer.test.ts` enforces one
      // writer for this table and it caught this script on the first run — which is the test
      // doing exactly its job, on the person who wrote it.
      await recordRefusal({
        offerId: t.id,
        merchantId: t.merchantId,
        storeName: t.storeName ?? t.name,
        rejectedPriceBani: t.refused,
        acceptedPriceBani: t.kept,
        rawPriceText: t.raw,
        reason: `recovered from corrupted provenance: ${t.reason}`,
      });
      recorded++;
    }
    await prisma.offer.update({
      where: { id: t.id },
      // Null, not the old string: we do not know what string produced the kept price.
      data: { rawPriceText: null, rawSourceBlob: null },
    });
    cleared++;
  }
  console.log(`\n  recorded ${recorded} refusal(s) into PriceAnomaly`);
  console.log(`  cleared rawPriceText on ${cleared} offer(s)`);
  console.log(`\n  This script has NOT verified its own work. Run: npm run audit:db\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
