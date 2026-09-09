// ── MARK THE PRICES THAT NEED A CARD, AND STOP A COLUMN ECHOING ANOTHER.
//
// Two defects, both live, both found by the 2026-09-09 loyalty sweep:
//
//   1. 17 Kaufland offers hold a CARD-ONLY price in `price`, with `requiresLoyaltyCard = false`.
//      `scrape-kaufland` takes `formattedPrice ?? loyaltyFormattedPrice`, so a flyer item headed
//      "Reducere cu Kaufland Card" contributes its card price as if anyone could pay it. Its own
//      comment predicted the consequence — "an unlabeled card price would silently undercut
//      every other store" — and nothing implemented the label.
//
//   2. `loyaltyPrice` on those same rows holds the SAME number as `price`, because one string
//      filled both. A column that duplicates another looks like a second fact and is none.
//
// The scraper is fixed; this repairs what it already wrote. Rows are identified from the offer's
// OWN `rawSourceBlob` — Kaufland's payload says whether `formattedPrice` was absent — rather
// than from "loyaltyPrice equals price", which is a symptom and would also catch a genuine
// coincidence.
//
// PER CLAUDE.md THIS SCRIPT DOES NOT VERIFY ITSELF. The invariant lives in `audit:db`
// ("no loyalty price that is not strictly below the price it accompanies"), which imports only
// PrismaClient and does not share a line of reasoning with this file.
//
//   npm run backfill:loyalty-card            report only
//   npm run backfill:loyalty-card -- --write

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const write = process.argv.includes("--write");

  const offers = await prisma.offer.findMany({
    where: { merchant: { slug: { in: ["kaufland", "glovo-kaufland"] } } },
    select: {
      id: true, price: true, priceBani: true, loyaltyPrice: true, loyaltyPriceBani: true,
      requiresLoyaltyCard: true, rawSourceBlob: true,
      merchant: { select: { slug: true } }, product: { select: { name: true } },
    },
  });

  const cardOnly: typeof offers = [];
  const echoing: typeof offers = [];

  for (const o of offers) {
    if (!o.rawSourceBlob) continue;
    let b: Record<string, unknown>;
    try { b = JSON.parse(o.rawSourceBlob) as Record<string, unknown>; } catch { continue; }
    const hasNormal = typeof b.formattedPrice === "string" && b.formattedPrice.trim().length > 0;
    const hasLoyal = typeof b.loyaltyFormattedPrice === "string" && b.loyaltyFormattedPrice.trim().length > 0;
    if (!hasNormal && hasLoyal) cardOnly.push(o);
    const shelf = o.priceBani ?? Math.round(o.price * 100);
    const card = o.loyaltyPriceBani ?? (o.loyaltyPrice != null ? Math.round(o.loyaltyPrice * 100) : null);
    if (card != null && card >= shelf) echoing.push(o);
  }

  console.log("═".repeat(96));
  console.log("LOYALTY-CARD BACKFILL — prices that need a card, and columns that echo another");
  console.log("═".repeat(96));
  console.log(`  offers examined                       ${offers.length}`);
  console.log(`  card-ONLY price (needs the flag)      ${cardOnly.length}`);
  console.log(`    …already flagged                    ${cardOnly.filter((o) => o.requiresLoyaltyCard).length}`);
  console.log(`  loyaltyPrice not BELOW price (echo)   ${echoing.length}`);

  console.log(`\n  CARD-ONLY ROWS — a shopper without the card cannot pay these:`);
  for (const o of cardOnly.slice(0, 20)) {
    console.log(`    #${o.id} ${((o.priceBani ?? Math.round(o.price * 100)) / 100).toFixed(2).padStart(8)} lei  flagged=${o.requiresLoyaltyCard}  ${o.product.name.slice(0, 46)}`);
  }
  if (cardOnly.length > 20) console.log(`    … and ${cardOnly.length - 20} more.`);

  if (!write) {
    console.log(`\n  DRY RUN. Re-run with --write to apply, then \`npm run audit:db\` to verify.`);
    await prisma.$disconnect();
    return;
  }

  // ── CLEAR THEN WRITE, scoped to what the rule now says — CLAUDE.md, "a script that assigns
  // must be able to unassign". A row that no longer looks card-only must lose the flag, or a
  // corrected rule can never take effect on a row the old one marked.
  const cardOnlyIds = new Set(cardOnly.map((o) => o.id));
  const kauflandIds = offers.map((o) => o.id);
  const cleared = await prisma.offer.updateMany({
    where: { id: { in: kauflandIds.filter((id) => !cardOnlyIds.has(id)) }, requiresLoyaltyCard: true },
    data: { requiresLoyaltyCard: false },
  });

  const flagged = await prisma.offer.updateMany({
    where: { id: { in: [...cardOnlyIds] } },
    data: { requiresLoyaltyCard: true },
  });

  // The echo: when the card figure IS the price, the flag carries the meaning and the column
  // goes back to null rather than repeating a number.
  const deEchoed = await prisma.offer.updateMany({
    where: { id: { in: echoing.map((o) => o.id) } },
    data: { loyaltyPrice: null, loyaltyPriceBani: null },
  });

  console.log(`\n  flag SET on          ${flagged.count}`);
  console.log(`  flag CLEARED from    ${cleared.count}`);
  console.log(`  echoing columns nulled ${deEchoed.count}`);
  console.log(`\n  Now run \`npm run audit:db\` — this script does not verify its own work.`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
