// Withhold the offers `audit:numeric-variant-codes` finds already smearing one price across
// products that differ by nothing but a numeric variant code (L'Oreal shade "613" vs "500",
// Chivas Regal "12 Ani" vs "25 Ani", shrimp count "16/20" vs "31/40"). Uses the reject mechanism
// (MatchOverride), exactly as `withhold-flyer-fanout.ts` did for Nivea/Lay's/Dove — a data
// decision on specific store items, not a matcher change. The regex that makes the matcher blind
// to these codes (`SIZE_TOKEN` in scrape-util.ts) is load-bearing and is NOT touched here or by
// this decision; the real fix is designed separately and graded before it ships.
//
// ── WHY WITHHOLD ALL MEMBERS, NOT JUST THE "WRONG" ONES.
//
// Every offer inside one cluster shares an IDENTICAL storeName — the scraped text itself does
// not name which candidate it means (Auchan's own "Casting Creme Gloss 500" offer is attached,
// as separate Offer rows, to the 500 AND the 613 AND the 603 shade). There is no name-only way to
// tell which one is right, which is the same conclusion the Nivea/Lay's/Dove case reached: when a
// flyer or listing line is genuinely ambiguous, asserting any single winner is asserting evidence
// we do not have. Withhold the whole cluster; a human (or the future variantCodeTokens fix) can
// resolve it later.
//
// ── THE SAME uniqueness SUBTLETY AS withhold-flyer-fanout.ts.
//
// MatchOverride is unique on (merchantId, storeKey). Every member of a cluster shares one
// storeName, hence one `slugify(storeName)` — so each row's key is
// `${slugify(storeName)}--variant-code-<productId>`, unique per product and stable across runs
// (idempotent: re-running finds the offers already flagged and skips them).
//
// Run: npx tsx scripts/withhold-numeric-variant-codes.ts [--apply]

import { prisma } from "../src/lib/db";
import { slugify } from "../src/lib/scrape-util";
import { findNumericCodeClusters } from "../src/lib/numeric-variant-codes";
import { reassertStandingDecisions } from "../src/lib/standing-decisions";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  console.log(`\n════ WITHHOLD NUMERIC VARIANT CODE FAN-OUT ${apply ? "" : "(DRY RUN)"} ═══════════════════════════════\n`);

  const clusters = await findNumericCodeClusters(prisma);
  // The flyer-fanout rule already withholds every physical-merchant cluster on its own next
  // scrape (confirmed live, docs/SOAK.md) — rejecting those here too would just be a second
  // writer of the same decision. Only act where nothing else is already handling it.
  const toWithhold = clusters.filter((c) => !c.physicalScoped);

  console.log(`  ${clusters.length} cluster(s) found, ${clusters.length - toWithhold.length} already covered by the flyer-fanout rule (skipped).`);
  console.log(`  ${toWithhold.length} cluster(s) to withhold here.\n`);

  let totalOffers = 0;
  let totalRejects = 0;

  for (const c of toWithhold) {
    const prices = c.members.flatMap((m) => m.offers.map((o) => (o.priceBani != null ? o.priceBani / 100 : o.price)));
    const lo = Math.min(...prices), hi = Math.max(...prices);
    const spread = lo === hi ? `${lo.toFixed(2)} lei (identical)` : `${lo.toFixed(2)}-${hi.toFixed(2)} lei (spread ${(((hi - lo) / lo) * 100).toFixed(0)}%)`;

    console.log(`  [${c.merchantName}] "${c.storeName}"  ${spread}`);
    const baseKey = slugify(c.storeName);

    for (const m of c.members) {
      console.log(`     code=${m.code.padEnd(10)} #${m.productId} "${m.productName.slice(0, 55)}"`);
      for (const o of m.offers) {
        const storeKey = `${baseKey}--variant-code-${m.productId}`;
        const priceStr = o.priceBani != null ? `${(o.priceBani / 100).toFixed(2)} lei` : `${o.price} lei`;
        console.log(`         offer ${String(o.id).padStart(6)}  ${priceStr.padStart(9)}  key="${storeKey}"`);
        totalOffers++;

        if (!apply) continue;

        const why = `numeric variant code fan-out — "${c.storeName}" matched onto ${c.members.length} products differing only by a code (${c.members.map((mm) => mm.code).join(" / ")}); the matcher strips bare numeric tokens as size noise and cannot see the code`;
        await prisma.offer.update({
          where: { id: o.id },
          data: { flagged: true, flagReason: why.slice(0, 240) },
        });
        await prisma.matchOverride.upsert({
          where: { merchantId_storeKey: { merchantId: c.merchantId, storeKey } },
          update: { productId: m.productId, decision: "reject", note: why.slice(0, 240) },
          create: { merchantId: c.merchantId, storeKey, productId: m.productId, decision: "reject", note: why.slice(0, 240) },
        });
        totalRejects++;
      }
    }
    console.log();
  }

  console.log(`  ${totalOffers} offer(s) across ${toWithhold.length} cluster(s).`);
  if (apply) {
    console.log(`  ✓ ${totalRejects} withheld and rejected. Reversible: set decision to "confirm" or delete the MatchOverride row.`);

    // A real scrape run calls this right after writing offers (scrape-util.ts). This script
    // withholds OUTSIDE that pipeline, so it must call it itself — otherwise a bulk tier
    // computed against one of these offers survives the flag, a discount on a price nobody may
    // see (`auditDerivedDataIsFresh`, audit-db.ts).
    const merchantIds = [...new Set(toWithhold.map((c) => c.merchantId))];
    let tiersCleared = 0;
    for (const id of merchantIds) tiersCleared += (await reassertStandingDecisions(id)).tiersCleared;
    console.log(`  ${tiersCleared} stale bulk tier(s) cleared across ${merchantIds.length} merchant(s).`);
  } else {
    console.log(`  DRY RUN — nothing written. Re-run with --apply.`);
  }
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
