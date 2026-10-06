// Withhold one Auchan fan-out: a single deep link matched to 9 different Paste Di Bari pasta
// shapes. Uses the reject mechanism (MatchOverride), not a matcher change — same pattern as
// withhold-flyer-fanout.ts, for one group instead of three.
//
// FOUND BY audit:db's fan-out check going red (worst group 9, target <= 8) the night WineMag's
// catalog landed — unrelated to WineMag itself; this is a pre-existing Auchan defect that just
// happened to be the one pushing the limit over 8 that same run. Auchan is the catalog's master
// merchant (CLAUDE.md), so a scope widening the way WineMag's fix at scrape-util.ts does is NOT
// made here — Auchan's own blast radius was not separately measured and is very likely large.
// This script fixes only the one group that is currently wrong, by name, the same way the
// Kaufland flyer fix did.
//
//   https://www.auchan.ro/paste-di-bari-barilotti-caserecci-500-g/p
//     -> Cavatappi, Eliche Rigate, Conchiglioni, Fusilli Trafilati, Calamarati, Paccheri Rigati,
//        Paccheri, Barilotti, Trofie — all "Caserecci/Caserecce, 500 g"
//
// "Caserecci"/"Caserecce" (home-style cut) is the dominant shared word; each pasta's own SHAPE
// name ("Cavatappi", "Trofie", …) is the one thing that tells them apart, and decide() is
// clearing every one of them against this single URL because the shape name isn't being
// weighted as a disqualifying mismatch. The URL itself names "barilotti" — confirmed as the
// correct product by checking which pasta shape the live page actually shows.
//
// Run: npx tsx scripts/withhold-auchan-paste-di-bari.ts [--apply]

import { prisma } from "../src/lib/db";
import { slugify } from "../src/lib/scrape-util";

const MERCHANT = "auchan";
const BAD_URL = "https://www.auchan.ro/paste-di-bari-barilotti-caserecci-500-g/p";
const CORRECT_PRODUCT_NAME = "Paste Di Bari Barilotti Caserecci, 500 g";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  console.log(`\n════ WITHHOLD AUCHAN PASTE DI BARI FAN-OUT ${apply ? "" : "(DRY RUN)"} ═══\n`);

  const merchant = await prisma.merchant.findUnique({ where: { slug: MERCHANT }, select: { id: true } });
  if (!merchant) throw new Error(`no merchant ${MERCHANT}`);

  const offers = await prisma.offer.findMany({
    where: { merchantId: merchant.id, productUrl: BAD_URL, isStale: false },
    select: { id: true, price: true, storeName: true, productId: true, product: { select: { name: true } } },
    orderBy: { productId: "asc" },
  });

  console.log(`  ${BAD_URL}\n  -> ${offers.length} matched product(s)`);
  if (offers.length === 0) {
    console.log("  (nothing found — already withheld, or the URL/catalog changed)");
    await prisma.$disconnect();
    return;
  }

  let rejected = 0;
  for (const o of offers) {
    const isCorrect = o.product.name === CORRECT_PRODUCT_NAME;
    console.log(`    offer ${String(o.id).padStart(8)}  ${o.price.toFixed(2).padStart(7)} lei  -> #${o.productId} "${o.product.name}"${isCorrect ? "  [KEEP — matches the URL's own product]" : "  [REJECT]"}`);
    if (isCorrect || !apply) continue;

    const why = `auchan fan-out — one deep link matched 9 different Paste Di Bari pasta shapes; "${CORRECT_PRODUCT_NAME}" is the one the URL itself names`;
    const storeKey = `${slugify(o.storeName ?? BAD_URL)}--paste-di-bari-${o.productId}`;
    await prisma.offer.update({ where: { id: o.id }, data: { flagged: true, flagReason: why.slice(0, 240) } });
    await prisma.matchOverride.upsert({
      where: { merchantId_storeKey: { merchantId: merchant.id, storeKey } },
      update: { productId: o.productId, decision: "reject", note: why.slice(0, 240) },
      create: { merchantId: merchant.id, storeKey, productId: o.productId, decision: "reject", note: why.slice(0, 240) },
    });
    rejected++;
  }

  if (apply) console.log(`\n  ✓ ${rejected} withheld and rejected. Reversible: set decision to "confirm" or delete the MatchOverride row.`);
  else console.log(`\n  DRY RUN — nothing written. Re-run with --apply.`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
