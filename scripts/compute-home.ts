// Precompute the shelf signals: the price drop, the between-store spread, and how many shops
// show a live price.
//
// WHY ANY OF THIS IS PRECOMPUTED. getHomeSections() used to load EVERY grocery product with
// EVERY offer and EVERY price-history row — 97,630 rows and 4.4 seconds — to render eight
// featured products and six drops. That was fixed by moving the drop into a column. /oferte was
// then measured doing exactly the same thing: 25,610 products, 35,365 offers and 53,839 history
// rows — 114,814 rows and 6.4 seconds — to render sixty cards. Same bug, second address.
//
// It needed two things a bounded query cannot supply: the spread, which needs every offer of a
// product, and the drop, which needs history. Both change once a night. So both are computed
// once a night, here, and /oferte becomes `ORDER BY dealScore DESC LIMIT 60`.
//
// THE COLUMNS ARE CLEARED, NOT LEFT, WHEN A PRODUCT FALLS OUT.
//
// A product whose last live offer disappears keeps whatever spread it had, and a stale "−40%"
// on something nobody sells any more is a number presented as an observation when nothing was
// observed. That is the defect this project keeps meeting, so the sweep at the end sets all
// four columns to NULL for every grocery product this run did not compute. NULL means "not
// computed"; 0 means "computed, and there is no spread". They must not look alike.
//
// This runs at the END of the nightly, after the scrapers, so the values are invalidated by the
// data actually changing rather than by a timer that is either too eager or too late.
//
// Verification is NOT here — a script may not verify its own work. `audit:db` carries the
// invariants (see "PRECOMPUTED SHELF SIGNALS" there).
//
// Run: npm run compute:home

import { PrismaClient } from "@prisma/client";
import { buildDailyLowSeries, dropPercent, isCurrent } from "../src/lib/pricing";

const prisma = new PrismaClient();

/** A drop is only interesting against a recent peak; a price that fell a year ago is not news. */
const WINDOW_DAYS = 30;

const bani = (o: { price: number; priceBani: number | null }): number => o.priceBani ?? Math.round(o.price * 100);

async function main(): Promise<void> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
  const t0 = Date.now();

  // Only products a shopper can act on, and only the history inside the window. Bounded on both
  // axes, and it runs once a night instead of once a request.
  const products = await prisma.product.findMany({
    where: { section: "grocery", offers: { some: { isStale: false, merchant: { active: true } } } },
    select: {
      id: true,
      offers: {
        where: { isStale: false, merchant: { active: true } },
        select: {
          price: true, priceBani: true, availability: true, isStale: true,
          flagged: true, priceSource: true, lastObservedAt: true,
          history: { where: { recordedAt: { gte: since } }, select: { price: true, recordedAt: true }, orderBy: { recordedAt: "asc" } },
        },
      },
    },
  });
  console.log(`  ${products.length} products, history since ${since.toISOString().slice(0, 10)} (${Date.now() - t0} ms)`);

  const now = new Date();
  type Row = { id: number; dropPct: number; spreadPct: number; dealScore: number; liveOfferCount: number };
  const rows: Row[] = [];

  for (const p of products) {
    const drop = dropPercent(buildDailyLowSeries(p.offers));

    // The SAME `isCurrent` the pages use. A second definition of "live" here is how the
    // sidebar count and the list it heads once disagreed.
    const live = p.offers.filter((o) => isCurrent(o as never, now));
    let spread = 0;
    if (live.length >= 2) {
      const prices = live.map(bani);
      const hi = Math.max(...prices);
      const lo = Math.min(...prices);
      if (hi > 0) spread = ((hi - lo) / hi) * 100;
    }

    rows.push({
      id: p.id,
      dropPct: drop,
      spreadPct: spread,
      dealScore: Math.max(spread, drop),
      liveOfferCount: live.length,
    });
  }

  // Chunked transactions: 25,000 autocommitted UPDATEs is a minutes-long job, the same work in
  // transactions of 500 is seconds.
  let written = 0;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    await prisma.$transaction(
      slice.map((r) =>
        prisma.product.update({
          where: { id: r.id },
          data: {
            dropPct: r.dropPct,
            spreadPct: r.spreadPct,
            dealScore: r.dealScore,
            liveOfferCount: r.liveOfferCount,
            dropComputedAt: now,
          },
        }),
      ),
    );
    written += slice.length;
    process.stdout.write(`\r  ${written}/${rows.length}`);
  }
  console.log(`\r  ${written}/${rows.length} products updated                              `);

  // ── THE SWEEP. Everything this run did not compute has its signals cleared.
  const computed = new Set(rows.map((r) => r.id));
  const stale = await prisma.product.findMany({
    where: {
      section: "grocery",
      id: { notIn: [] },
      OR: [{ dropPct: { not: null } }, { spreadPct: { not: null } }, { dealScore: { not: null } }, { liveOfferCount: { not: null } }],
    },
    select: { id: true },
  });
  const toClear = stale.map((s) => s.id).filter((id) => !computed.has(id));
  for (let i = 0; i < toClear.length; i += CHUNK) {
    await prisma.product.updateMany({
      where: { id: { in: toClear.slice(i, i + CHUNK) } },
      data: { dropPct: null, spreadPct: null, dealScore: null, liveOfferCount: null, dropComputedAt: null },
    });
  }
  console.log(`  ${toClear.length} products cleared (no live offer left — a stale spread is a lie)`);

  const withDrop = rows.filter((r) => r.dropPct > 2).length;
  const withSpread = rows.filter((r) => r.spreadPct >= 8).length;
  const comparable = rows.filter((r) => r.liveOfferCount >= 2).length;
  console.log(`\n  ${withDrop} with a drop over 2%, ${withSpread} with a spread of 8%+, ${comparable} priced at 2+ shops`);

  const top = await prisma.product.findMany({
    where: { section: "grocery", dealScore: { gt: 2 }, liveOfferCount: { gte: 2 } },
    select: { name: true, dealScore: true, spreadPct: true, dropPct: true },
    orderBy: { dealScore: "desc" },
    take: 6,
  });
  console.log("\n  biggest deal scores:");
  for (const t of top) {
    console.log(`    ${(t.dealScore ?? 0).toFixed(1).padStart(5)}%  (spread ${(t.spreadPct ?? 0).toFixed(0)}%, drop ${(t.dropPct ?? 0).toFixed(0)}%)  ${t.name.slice(0, 52)}`);
  }
  console.log(`\n  done in ${((Date.now() - t0) / 1000).toFixed(1)} s\n`);

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
