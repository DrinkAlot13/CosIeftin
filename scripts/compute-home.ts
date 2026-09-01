// Precompute the homepage's "price dropped" signal.
//
// getHomeSections() used to load EVERY grocery product with EVERY offer and EVERY price-history
// row — 97,630 rows and 4.4 seconds — to render eight featured products and six drops. The data
// changes once a night, so computing it per request was paying a full-catalog scan for an answer
// that had not changed since the last scrape.
//
// This runs at the END of the nightly, after the scrapers, so the cache is invalidated by the
// data actually changing rather than by a timer that is either too eager or too late.
//
// Run: npm run compute:home

import { PrismaClient } from "@prisma/client";
import { buildDailyLowSeries, dropPercent } from "../src/lib/pricing";

const prisma = new PrismaClient();

/** A drop is only interesting against a recent peak; a price that fell a year ago is not news. */
const WINDOW_DAYS = 30;

async function main(): Promise<void> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
  const t0 = Date.now();

  // Only products a shopper can act on, and only the history inside the window. This is the
  // same shape as before but bounded on both axes, and it runs once a night instead of once a
  // request.
  const products = await prisma.product.findMany({
    where: { section: "grocery", offers: { some: { isStale: false, merchant: { active: true } } } },
    select: {
      id: true,
      offers: {
        where: { isStale: false, merchant: { active: true } },
        select: { history: { where: { recordedAt: { gte: since } }, select: { price: true, recordedAt: true }, orderBy: { recordedAt: "asc" } } },
      },
    },
  });
  console.log(`  ${products.length} products, history since ${since.toISOString().slice(0, 10)} (${Date.now() - t0} ms)`);

  const now = new Date();
  let written = 0;
  let withDrop = 0;
  for (const p of products) {
    const pct = dropPercent(buildDailyLowSeries(p.offers));
    // Store 0 rather than null when there is no drop: null means "never computed", and the two
    // must not look alike to a query that orders by this column.
    await prisma.product.update({ where: { id: p.id }, data: { dropPct: pct, dropComputedAt: now } });
    written++;
    if (pct > 2) withDrop++;
    if (written % 2000 === 0) process.stdout.write(`\r  ${written}/${products.length}`);
  }
  console.log(`\r  ${written}/${products.length} products updated, ${withDrop} with a drop over 2%        `);

  const top = await prisma.product.findMany({
    where: { section: "grocery", dropPct: { gt: 2 } },
    select: { name: true, dropPct: true },
    orderBy: { dropPct: "desc" },
    take: 6,
  });
  console.log("\n  biggest drops:");
  for (const t of top) console.log(`    ${(t.dropPct ?? 0).toFixed(1).padStart(6)}%  ${t.name.slice(0, 58)}`);
  console.log(`\n  total ${Date.now() - t0} ms\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
