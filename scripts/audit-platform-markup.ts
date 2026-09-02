// ── SCOPE: DATA INTEGRITY ─────────────────────────────────────────────────────
// What does a delivery platform actually charge over the shelf price?
//
// The brief assumes a markup. Glovo's own Kaufland storefront says "Preț ca în magazin" —
// price as in store — so the assumption has to be MEASURED rather than asserted. If the claim is
// true the margin is the 6,99 lei delivery fee, not the goods; if it is false, by how much.
//
// Method: for every catalog product that has BOTH a DELIVERY_PLATFORM offer and a non-platform
// offer at the same underlying chain, compare the two prices. Median and spread, per merchant.
// Only in-stock, unflagged offers on both sides — a withheld price is not evidence.
//
// Read-only. Run: npm run audit:markup

import { PrismaClient } from "@prisma/client";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();
const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const lp = (s: string | number, n: number) => String(s).padStart(n);
const lei = (b: number) => (b / 100).toFixed(2);

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

async function main(): Promise<void> {
  const platformMerchants = await prisma.merchant.findMany({
    where: { priceChannel: "aggregator" },
    select: { id: true, slug: true, name: true },
  });
  if (platformMerchants.length === 0) { console.log("No aggregator merchants."); await prisma.$disconnect(); return; }

  console.log(`\n════ DELIVERY-PLATFORM MARKUP ═══════════════════════════════════════════════`);

  const report: unknown[] = [];
  for (const pm of platformMerchants) {
    // Products this platform storefront prices.
    const rows = await prisma.product.findMany({
      where: { offers: { some: { merchantId: pm.id, isStale: false, flagged: false, availability: "in stock" } } },
      select: {
        id: true, name: true, unit: true,
        offers: {
          where: { isStale: false, flagged: false, availability: "in stock" },
          select: { priceBani: true, price: true, priceSource: true, merchant: { select: { slug: true, name: true } } },
        },
      },
    });

    const pairs: { name: string; platformBani: number; shelfBani: number; shelfFrom: string; deltaBani: number; pct: number }[] = [];
    for (const p of rows) {
      const bani = (o: { priceBani: number | null; price: number }) => o.priceBani ?? Math.round(o.price * 100);
      const plat = p.offers.filter((o) => o.priceSource === "DELIVERY_PLATFORM" && o.merchant.slug === pm.slug);
      const other = p.offers.filter((o) => o.priceSource !== "DELIVERY_PLATFORM");
      if (plat.length === 0 || other.length === 0) continue;
      const platformBani = Math.min(...plat.map(bani));
      // Compare against the CHEAPEST non-platform price for the same product — that is what a
      // shopper is actually giving up by ordering through the platform.
      const best = other.reduce((a, b) => (bani(b) < bani(a) ? b : a));
      const shelfBani = bani(best);
      if (shelfBani <= 0 || platformBani <= 0) continue;
      pairs.push({
        name: p.name, platformBani, shelfBani, shelfFrom: best.merchant.name,
        deltaBani: platformBani - shelfBani,
        pct: ((platformBani - shelfBani) / shelfBani) * 100,
      });
    }

    console.log(`\n  ${pm.name} (${pm.slug})`);
    console.log(`  overlapping products with a comparable non-platform price: ${pairs.length}`);
    if (pairs.length === 0) {
      console.log("  nothing to compare — no product is priced both on the platform and off it.");
      report.push({ merchant: pm.slug, pairs: 0 });
      continue;
    }

    const pcts = pairs.map((p) => p.pct).sort((a, b) => a - b);
    const deltas = pairs.map((p) => p.deltaBani).sort((a, b) => a - b);
    const median = quantile(pcts, 0.5);
    const p25 = quantile(pcts, 0.25), p75 = quantile(pcts, 0.75);
    const p10 = quantile(pcts, 0.10), p90 = quantile(pcts, 0.90);
    const dearer = pairs.filter((p) => p.deltaBani > 0).length;
    const cheaper = pairs.filter((p) => p.deltaBani < 0).length;
    const same = pairs.length - dearer - cheaper;

    console.log(`  MEDIAN MARKUP: ${median.toFixed(1)}%   (median absolute: ${lei(quantile(deltas, 0.5))} lei)`);
    console.log(`  spread: p10 ${p10.toFixed(1)}% · p25 ${p25.toFixed(1)}% · p75 ${p75.toFixed(1)}% · p90 ${p90.toFixed(1)}%`);
    console.log(`  dearer on platform: ${dearer} · cheaper: ${cheaper} · identical: ${same}`);

    const worst = [...pairs].sort((a, b) => b.pct - a.pct).slice(0, 8);
    console.log(`\n  ${pad("biggest premiums", 46)}${lp("platform", 10)}${lp("elsewhere", 11)}${lp("delta", 9)}`);
    for (const w of worst) {
      console.log(`  ${pad(w.name, 46)}${lp(lei(w.platformBani), 10)}${lp(lei(w.shelfBani), 11)}${lp(w.pct.toFixed(0) + "%", 9)}  ${w.shelfFrom}`);
    }
    const best = [...pairs].sort((a, b) => a.pct - b.pct).slice(0, 5);
    console.log(`\n  ${pad("cheapest on the platform", 46)}${lp("platform", 10)}${lp("elsewhere", 11)}${lp("delta", 9)}`);
    for (const w of best) {
      console.log(`  ${pad(w.name, 46)}${lp(lei(w.platformBani), 10)}${lp(lei(w.shelfBani), 11)}${lp(w.pct.toFixed(0) + "%", 9)}  ${w.shelfFrom}`);
    }

    report.push({
      merchant: pm.slug, pairs: pairs.length,
      medianPct: median, p10, p25, p75, p90,
      medianDeltaBani: quantile(deltas, 0.5), dearer, cheaper, same,
    });
  }

  console.log(`\n  A platform price is NOT comparable with a shelf price and is excluded from the`);
  console.log(`  optimizer, item pages, deals, counts, search and comparability by default.`);
  console.log(`  This audit reads every row regardless, which is why it can measure the gap.\n`);

  emitJson({ merchants: report });
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
