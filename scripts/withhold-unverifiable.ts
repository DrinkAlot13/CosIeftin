// Withhold offers that CANNOT BE RE-JUDGED and are no longer live.
//
// The Pepsi page after a full re-scrape:
//
//   auchan      "…zmeura Pepsi, doza, 6 x 0.33 l"  packCount 6  matched by EAN   ← correct
//   freshful    storeName NULL  stale  matchedBy "scraper"                       ← ?
//   mega-image  storeName NULL  stale  matchedBy "scraper"  10,49                ← ?
//   carrefour   storeName NULL  stale  matchedBy "scraper"  10,49                ← ?
//
// The variant hard block works — Auchan's genuine six-pack matched by EAN, and nothing new
// attached wrongly. But the block only governs matches the matcher MAKES. Three offers from
// the pre-block era were still sitting on the product, because their merchants' fresh runs
// simply did not re-match them, so the rows were marked stale and left where they were.
//
// They render as table rows claiming Mega Image and Carrefour carry this six-pack at 10,49.
// They are stale, so they hold no headline and win no "cel mai mic preț" — but the claim is
// still on the page, and it is the exact claim the user reported six sessions ago.
//
// WHY THESE AND NOT ALL STALE OFFERS. A stale offer with its own recorded name is a fact:
// "this shop sold this, at this price, on this date", and the out-of-stock decision says to
// keep showing it with its date. These have NO name of their own. We cannot re-judge whether
// the match was ever right, and they were made by the matcher we have since proven wrong —
// `matchedBy = "scraper"` or a null score means the pre-band path with no confidence recorded.
// An unverifiable claim from a discredited source, on a page, is not a fact worth keeping.
//
// NOTHING IS DELETED. The rows keep their prices and their history; they are flagged, which
// removes them from display and from every count, and a re-scrape that sees the product again
// writes a real offer with a real name and clears it.
//
// Dry run:  npm run withhold:unverifiable
// Apply:    npm run withhold:unverifiable -- --apply

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));

async function main(): Promise<void> {
  const targets = await prisma.offer.findMany({
    where: {
      storeName: null,
      isStale: true,
      flagged: false,
      OR: [{ matchedBy: "scraper" }, { matchScore: null }],
    },
    select: {
      id: true, price: true, matchedBy: true, matchScore: true, lastObservedAt: true,
      merchant: { select: { slug: true } },
      product: { select: { id: true, name: true } },
    },
  });

  const byMerchant = new Map<string, number>();
  for (const t of targets) byMerchant.set(t.merchant.slug, (byMerchant.get(t.merchant.slug) ?? 0) + 1);
  const products = new Set(targets.map((t) => t.product.id));

  console.log("\n════ UNVERIFIABLE LEGACY MATCHES ════════════════════════════════════════════");
  console.log("  Stale, no name of their own, made by the pre-band matcher. Cannot be");
  console.log("  re-judged, and the matcher that made them has been proven wrong.\n");
  console.log(`  offers: ${targets.length} across ${products.size} products`);
  console.log(`  by merchant: ${[...byMerchant.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  ")}`);

  // How many products lose their LAST showable row? Those pages become "no current price",
  // which is the honest state but worth counting before doing it.
  let losesEverything = 0;
  for (const pid of products) {
    const showable = await prisma.offer.count({
      where: { productId: pid, isStale: false, flagged: false, availability: "in stock" },
    });
    if (showable === 0) losesEverything++;
  }
  console.log(`  products with NO showable offer either way: ${losesEverything}`);
  console.log(`  (those pages already show no current price; this changes what rows appear)`);

  console.log(`\n  first 10:`);
  for (const t of targets.slice(0, 10)) {
    console.log(`    ${pad(t.merchant.slug, 12)} ${pad(t.product.name.slice(0, 46), 48)} ` +
      `${t.price} lei  matchedBy=${t.matchedBy}  seen ${t.lastObservedAt?.toISOString().slice(0, 10) ?? "never"}`);
  }

  if (!APPLY) {
    console.log(`\n  DRY RUN — nothing written. Re-run with --apply.\n`);
    await prisma.$disconnect();
    return;
  }

  const r = await prisma.offer.updateMany({
    where: { id: { in: targets.map((t) => t.id) } },
    data: {
      flagged: true,
      flagReason:
        "withheld: no name of its own and matched by the pre-band matcher, so the match " +
        "cannot be re-judged. A re-scrape that sees this product again replaces it.",
    },
  });
  console.log(`\n  withheld ${r.count} offer(s). Prices and history intact, nothing deleted.`);
  console.log(`  This script has NOT verified its own work. Run: npm run verify:pepsi\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
