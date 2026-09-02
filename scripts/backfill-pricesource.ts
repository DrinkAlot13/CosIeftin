// Normalize Offer.priceSource to one vocabulary.
//
// The catalog held five spellings of a four-value field, and two live read sites compared
// against the string literal "shelf" — so 13,412 uppercase SHELF offers took the wrong branch
// in the optimizer.
//
// This script does NOT verify itself. Per CLAUDE.md, verification lives in audit-db.ts, which
// imports only PrismaClient: "priceSource uses only the documented vocabulary". A script that
// reports its own success is reporting that it agrees with itself, which is how backfill-phase1
// under-counted by 19,000 while printing a green line.
//
// Run: npm run backfill:pricesource            (dry run)
//      npm run backfill:pricesource -- --apply

import { PrismaClient } from "@prisma/client";
import { normalizePriceSource, PRICE_SOURCES } from "../src/lib/price-source";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main(): Promise<void> {
  console.log(APPLY ? "APPLY — this writes.\n" : "DRY RUN — add --apply to write.\n");

  const groups = await prisma.offer.groupBy({ by: ["priceSource"], _count: true });
  console.log("  stored value        ->  canonical        offers");
  const plan: { from: string; to: string; n: number }[] = [];
  for (const g of groups.sort((a, b) => b._count - a._count)) {
    const from = g.priceSource ?? "(null)";
    const to = normalizePriceSource(g.priceSource);
    plan.push({ from, to, n: g._count });
    const mark = from === to ? "" : "   <- rewrite";
    console.log(`  ${from.padEnd(20)}->  ${to.padEnd(18)}${String(g._count).padStart(6)}${mark}`);
  }
  const changing = plan.filter((p) => p.from !== p.to);
  console.log(`\n  ${changing.reduce((n, p) => n + p.n, 0)} offers to rewrite across ${changing.length} spellings`);
  console.log(`  canonical vocabulary: ${PRICE_SOURCES.join(" | ")}`);

  if (!APPLY) {
    console.log("\n  DRY RUN — nothing written.\n");
    await prisma.$disconnect();
    return;
  }

  for (const p of changing) {
    const r = await prisma.offer.updateMany({
      where: p.from === "(null)" ? {} : { priceSource: p.from },
      data: { priceSource: p.to },
    });
    console.log(`  ${p.from} -> ${p.to}: ${r.count} rewritten`);
  }
  console.log("\n  Written. Run `npm run audit:db` for verification — this script does not");
  console.log("  verify its own work, on purpose.\n");
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
