// Products whose offers disagree about the unit price by 2x or more.
//
// Two shops do not charge four times as much for the same thing. When our data says they do,
// the near-certain explanation is that they are not the same thing — a bad match, showing one
// product's price on another. That was 81 products when it was first measured, worst case
// 24.3x (freshful 1,69 against sezamo 40,99 on one "product"). After a full re-scrape under
// the variant block it is 60, worst case 5.9x.
//
// WHAT WITHHOLDING MEANS HERE. The cheapest offer stays and the page becomes a single-shop
// price record; every other offer on that product is flagged. That keeps a real price visible
// while removing the cross-store CLAIM, which is the part that is wrong. Hiding the product
// entirely would throw away a price we have no reason to doubt.
//
// The cheapest is kept rather than the most expensive on purpose: if the match is wrong, the
// cheapest is the one least likely to mislead someone into overpaying, and a shopper who
// clicks through sees the real product on the merchant's own page.
//
// Every withheld pair is queued to /admin/matches so a human can split them properly.
//
// Dry run:  npm run withhold:spread
// Apply:    npm run withhold:spread -- --apply

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

/** Above this ratio between the cheapest and dearest unit price, the match is suspect. */
const SPREAD_LIMIT = 2;

const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));

async function main(): Promise<void> {
  const products = await prisma.product.findMany({
    where: { offers: { some: { isStale: false, flagged: false, availability: "in stock" } } },
    select: {
      id: true, name: true, slug: true, section: true, unit: true,
      offers: {
        where: { isStale: false, flagged: false, availability: "in stock" },
        select: {
          id: true, price: true, priceBani: true, pricePerUnit: true, storeName: true,
          matchScore: true, matchedBy: true, merchantId: true,
          merchant: { select: { slug: true } },
        },
      },
    },
  });

  type Bad = {
    id: number; name: string; slug: string; section: string; spread: number;
    keep: number; drop: { id: number; slug: string; ppu: number; storeName: string | null; merchantId: number; price: number }[];
  };
  const bad: Bad[] = [];

  for (const p of products) {
    const priced = p.offers.filter((o) => o.pricePerUnit > 0);
    if (priced.length < 2) continue;
    const ppus = priced.map((o) => o.pricePerUnit);
    const lo = Math.min(...ppus);
    const hi = Math.max(...ppus);
    if (lo <= 0 || hi / lo < SPREAD_LIMIT) continue;
    // Keep the cheapest BY PRICE, which is what the page would show as the headline.
    const cheapest = priced.reduce((a, b) => (b.price < a.price ? b : a));
    bad.push({
      id: p.id, name: p.name, slug: p.slug, section: p.section, spread: hi / lo,
      keep: cheapest.id,
      drop: priced.filter((o) => o.id !== cheapest.id).map((o) => ({
        id: o.id, slug: o.merchant.slug, ppu: o.pricePerUnit, storeName: o.storeName,
        merchantId: o.merchantId, price: o.price,
      })),
    });
  }
  bad.sort((a, b) => b.spread - a.spread);

  const offersToDrop = bad.reduce((n, b) => n + b.drop.length, 0);
  console.log("\n════ UNIT-PRICE SPREAD ≥ 2x — SUSPECT MATCHES ═══════════════════════════════");
  console.log(`  products with 2+ showable offers: ${products.filter((p) => p.offers.filter((o) => o.pricePerUnit > 0).length >= 2).length}`);
  console.log(`  products above ${SPREAD_LIMIT}x spread:            ${bad.length}`);
  console.log(`  offers that would be withheld:     ${offersToDrop} (the cheapest on each product stays)`);
  const bySection = new Map<string, number>();
  for (const b of bad) bySection.set(b.section, (bySection.get(b.section) ?? 0) + 1);
  console.log(`  by section: ${[...bySection.entries()].map(([k, v]) => `${k}=${v}`).join("  ")}`);

  console.log(`\n  WORST 20 REMAINING:`);
  for (const b of bad.slice(0, 20)) {
    console.log(`    ${b.spread.toFixed(1)}x  ${pad(b.name.slice(0, 52), 54)} /p/${b.slug.slice(0, 40)}`);
    for (const d of b.drop.slice(0, 3)) {
      console.log(`         withhold ${pad(d.slug, 12)} ${d.price.toFixed(2).padStart(8)} lei  ${d.ppu.toFixed(2).padStart(9)}/unit  ${JSON.stringify((d.storeName ?? "").slice(0, 34))}`);
    }
  }

  if (!APPLY) {
    console.log(`\n  DRY RUN — nothing written. Re-run with --apply.\n`);
    await prisma.$disconnect();
    return;
  }

  let flagged = 0;
  let queued = 0;
  for (const b of bad) {
    for (const d of b.drop) {
      await prisma.offer.update({
        where: { id: d.id },
        data: {
          flagged: true,
          flagReason:
            `withheld: unit price disagrees with the cheapest offer on this product by ` +
            `${b.spread.toFixed(1)}x, which is a wrong match rather than a price difference`,
        },
      });
      flagged++;
      // Queue for a human to split. storeKey is the offer's own name where we have one; a
      // null name is exactly the case a person needs to look at on the merchant's page.
      const storeKey = (d.storeName ?? `offer-${d.id}`).slice(0, 190);
      await prisma.pendingMatch.upsert({
        where: { merchantId_storeKey_productId: { merchantId: d.merchantId, storeKey, productId: b.id } },
        update: { reason: "unit-price-spread", score: 0, resolved: false },
        create: {
          merchantId: d.merchantId, storeKey, productId: b.id, section: b.section,
          storeName: d.storeName ?? `(fără nume) offer ${d.id}`,
          storePriceBani: Math.round(d.price * 100),
          score: 0, reason: "unit-price-spread",
        },
      }).then(() => { queued++; }).catch(() => {});
    }
  }
  console.log(`\n  withheld ${flagged} offer(s) across ${bad.length} products; queued ${queued} to /admin/matches.`);
  console.log(`  Nothing deleted. The cheapest offer on each product still shows.`);
  console.log(`  This script has NOT verified its own work. Run: npm run audit:unitprice\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
