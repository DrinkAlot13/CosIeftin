// Withhold every price a history-anchored gate kept over a fresher one. Do not delete.
//
// 135 stored prices were preferred to a newer observation by a gate that has since been
// proven wrong in principle: it assumes history is more trustworthy than the new reading,
// which is exactly inverted while parsers are being corrected. Four cases examined by hand
// went four for four against it.
//
// 106 of the 135 are DCNeu rows from the fabricated-price era, holding values four to six
// times too low — a 6-pack of Protex soap at 2,74 against a real 21,24 — and they are LIVE.
// That is the most user-visible wrong data left on the site.
//
// WITHHOLDING IS NOT DELETING. The row keeps its price, its history and its anomaly record;
// it is flagged, which is what removes it from display and from the optimizer. A later
// re-scrape or a human decision can clear it. Deleting would destroy the very evidence that
// lets someone decide which number was right.
//
// Dry run:  npm run withhold:kept-over-refused
// Apply:    npm run withhold:kept-over-refused -- --apply

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const lei = (b: number | null | undefined): string => (b == null ? "—" : (b / 100).toFixed(2));

async function main(): Promise<void> {
  const rows = await prisma.priceAnomaly.findMany({
    where: { rejectedPriceBani: { gt: 0 }, acceptedPriceBani: { not: null } },
    select: {
      id: true, offerId: true, rejectedPriceBani: true, acceptedPriceBani: true,
      merchant: { select: { slug: true } },
      offer: { select: { id: true, price: true, priceBani: true, flagged: true, flagReason: true } },
    },
  });

  const targets = rows.filter((r) => {
    if (!r.offer) return false;
    const current = r.offer.priceBani ?? Math.round(r.offer.price * 100);
    // Only where the KEPT value is still what we store. If it has since been overwritten by a
    // fresh observation, there is nothing to withhold.
    return r.acceptedPriceBani != null && Math.abs(current - r.acceptedPriceBani) <= 1;
  });

  const byMerchant = new Map<string, number>();
  const alreadyFlagged = targets.filter((t) => t.offer?.flagged).length;
  for (const t of targets) byMerchant.set(t.merchant?.slug ?? "?", (byMerchant.get(t.merchant?.slug ?? "?") ?? 0) + 1);

  console.log(`\nSubstituted prices still stored: ${targets.length} of ${rows.length} recorded`);
  console.log(`  already flagged (so already withheld): ${alreadyFlagged}`);
  console.log(`  by merchant: ${[...byMerchant.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  ")}`);
  console.log(`\n  first 8:`);
  for (const t of targets.slice(0, 8)) {
    console.log(`    offer ${String(t.offerId).padStart(6)} [${(t.merchant?.slug ?? "?").padEnd(11)}] ` +
      `stores ${lei(t.acceptedPriceBani).padStart(8)}, refused ${lei(t.rejectedPriceBani).padStart(8)}` +
      `${t.offer?.flagged ? "  (already withheld)" : ""}`);
  }

  if (!APPLY) {
    console.log(`\n  DRY RUN — nothing written. Re-run with --apply.\n`);
    await prisma.$disconnect();
    return;
  }

  let n = 0;
  for (const t of targets) {
    if (!t.offerId) continue;
    await prisma.offer.update({
      where: { id: t.offerId },
      data: {
        flagged: true,
        flagReason:
          `withheld: a history-anchored gate kept ${lei(t.acceptedPriceBani)} over a fresher ` +
          `${lei(t.rejectedPriceBani)}. That gate is no longer trusted to decide — see /admin/anomalies`,
      },
    });
    n++;
  }
  console.log(`\n  withheld ${n} offer(s) from display. Prices, history and anomaly records are intact.`);
  console.log(`  This script has NOT verified its own work. Run: npm run audit:db\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
