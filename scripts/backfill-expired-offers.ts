// Backfill: `isExpired` is a write-time snapshot (set from `promoValidTo` only when an offer is
// actually re-scraped — see scrape-util.ts's `matchPoolToCatalog`), so an offer that stops being
// re-scraped keeps whatever `isExpired` it was last written with forever. `audit:db`'s "no offer
// past promoValidTo left unmarked as expired" found 100 such rows, all Kaufland — a FLYER source
// scraped far less often than a full online catalog, so its promo windows pass between runs.
//
// This corrects the EXISTING rows. It does not fix the forward-looking gap on its own — that is
// `lib/pricing.ts`'s `isCurrent()` and `lib/queries.ts`'s `currentOfferWhere()`, both now checking
// `promoValidTo` directly rather than trusting this column — but the column itself should still
// be honest for any other code that reads it (audit-db.ts's own WITHOUT_VAT check does, with no
// dynamic fallback).
//
// Verification is `npm run audit:db`'s existing check, per CLAUDE.md: "a migration or backfill
// script may not verify its own work."
//
//   npm run backfill:expired-offers                report only
//   npm run backfill:expired-offers -- --write

import { prisma } from "../src/lib/db";

async function main() {
  const write = process.argv.includes("--write");
  const now = new Date();

  const rows = await prisma.offer.findMany({
    where: { promoValidTo: { lt: now }, isExpired: false },
    select: { id: true, promoValidTo: true, merchant: { select: { name: true, slug: true } } },
  });

  const byMerchant = new Map<string, number>();
  for (const r of rows) byMerchant.set(r.merchant.name, (byMerchant.get(r.merchant.name) ?? 0) + 1);

  console.log(`${rows.length} offer(s) past their promoValidTo but still marked isExpired=false:`);
  for (const [name, count] of byMerchant) console.log(`  ${name.padEnd(20)} ${count}`);

  if (!write) {
    console.log("\nDRY RUN — nothing written. Re-run with --write.");
    await prisma.$disconnect();
    return;
  }

  const result = await prisma.offer.updateMany({
    where: { promoValidTo: { lt: now }, isExpired: false },
    data: { isExpired: true },
  });
  console.log(`\nMarked ${result.count} offer(s) isExpired=true.`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
