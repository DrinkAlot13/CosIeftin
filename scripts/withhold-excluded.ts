// Tobacco already in the catalog: count it, then withhold it from display.
//
// The pool-level exclusion stops anything new getting in. This deals with what is already
// there. Withholding rather than deleting, for the same reason as everywhere else in this
// project: a deleted row cannot be reviewed, and the classifier is a word list, which is a
// thing that gets a judgement call wrong occasionally and should be correctable.
//
// Dry run:  npm run withhold:excluded
// Apply:    npm run withhold:excluded -- --apply

import { PrismaClient } from "@prisma/client";
import { exclusionReason } from "../src/lib/excluded-categories";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));

async function main(): Promise<void> {
  const products = await prisma.product.findMany({
    select: {
      id: true, name: true, brand: true, section: true, slug: true,
      offers: { select: { id: true, isStale: true, flagged: true, merchant: { select: { slug: true } } } },
    },
  });

  type Hit = { id: number; name: string; section: string; reason: string; offers: number; live: number; merchants: string[] };
  const hits: Hit[] = [];
  for (const p of products) {
    const reason = exclusionReason(p.name, p.brand);
    if (!reason) continue;
    hits.push({
      id: p.id, name: p.name, section: p.section, reason,
      offers: p.offers.length,
      live: p.offers.filter((o) => !o.isStale && !o.flagged).length,
      merchants: [...new Set(p.offers.map((o) => o.merchant.slug))],
    });
  }

  const bySection = new Map<string, number>();
  const byMerchant = new Map<string, number>();
  let totalOffers = 0, totalLive = 0;
  for (const h of hits) {
    bySection.set(h.section, (bySection.get(h.section) ?? 0) + 1);
    for (const m of h.merchants) byMerchant.set(m, (byMerchant.get(m) ?? 0) + 1);
    totalOffers += h.offers;
    totalLive += h.live;
  }

  console.log(`\n════ EXCLUDED PRODUCTS ALREADY IN THE CATALOG ═══════════════════════════════`);
  console.log(`  catalog scanned: ${products.length} products`);
  console.log(`  matching an excluded category: ${hits.length} products, ${totalOffers} offers, ${totalLive} currently LIVE`);
  console.log(`  by section:  ${[...bySection.entries()].map(([k, v]) => `${k}=${v}`).join("  ") || "—"}`);
  console.log(`  by merchant: ${[...byMerchant.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  ") || "—"}`);

  if (hits.length > 0) {
    console.log(`\n  ALL ${hits.length} (review these — the classifier is a word list, not a lawyer):`);
    for (const h of hits.slice(0, 60)) {
      console.log(`    ${pad(h.name, 56)} ${pad(h.section, 10)} ${h.reason.padEnd(9)} ${h.offers} offers (${h.live} live) [${h.merchants.join(",")}]`);
    }
    if (hits.length > 60) console.log(`    … and ${hits.length - 60} more`);
  }

  // ── RESTORE, and it is reported in a DRY RUN too.
  //
  // The classifier is a word list, and word lists get judgement calls wrong. Withholding is
  // only defensible if it is reversible from the same script that applied it, so anything
  // previously withheld under this reason that no longer matches is put back — which is how
  // the Farmacia Tei nicotine-replacement spray returns.
  //
  // A restore that only ran under --apply would be invisible in the dry run, which is the
  // one place a reviewer looks before deciding.
  const previously = await prisma.offer.findMany({
    where: { flagged: true, flagReason: { contains: "excluded category" } },
    select: { id: true, product: { select: { id: true, name: true } } },
  });
  const stillExcluded = new Set(hits.map((h) => h.id));
  const toRestore = previously.filter((o) => !stillExcluded.has(o.product.id));
  if (toRestore.length > 0) {
    console.log(`\n  RESTORING ${toRestore.length} offer(s) that no longer match an excluded category:`);
    for (const o of toRestore.slice(0, 10)) console.log(`    ${o.product.name.slice(0, 70)}`);
  }

  if (!APPLY) {
    console.log(`\n  DRY RUN — nothing written. Re-run with --apply.\n`);
    await prisma.$disconnect();
    return;
  }

  for (const o of toRestore) {
    await prisma.offer.update({ where: { id: o.id }, data: { flagged: false, flagReason: null } });
  }

  let n = 0;
  for (const h of hits) {
    const r = await prisma.offer.updateMany({
      where: { productId: h.id },
      data: {
        flagged: true,
        flagReason: `withheld: excluded category (${h.reason}) — see src/lib/excluded-categories.ts`,
      },
    });
    n += r.count;
  }
  console.log(`\n  withheld ${n} offer(s) across ${hits.length} product(s). Nothing deleted.`);
  console.log(`  This script has NOT verified its own work. Run: npm run audit:db\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
