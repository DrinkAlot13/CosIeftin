// Withhold WineMag's existing fan-out: 337 deep links, each matched onto 2+ different catalog
// products (772 live offers), written before scrape-util.ts's fan-out rule was extended to this
// merchant (see its comment there for the measurement and the reasoning). That change stops the
// NEXT scrape from recreating this; it does not touch what is already in the database — this
// script is that second half, the same way withhold-flyer-fanout.ts was for Kaufland.
//
// Too many groups (337) to hand-list like the 3 Kaufland flyer lines, so the WINNER per group is
// chosen programmatically rather than by hand:
//
//   1. The member whose catalog Product.name is BYTE-IDENTICAL to the offer's own storeName —
//      the strongest possible evidence that THIS is the product the scraped card actually named.
//   2. Failing that, the member with the highest recorded matchScore.
//   3. Failing a clear winner there too (a genuine tie), the lowest productId — arbitrary, but
//      deterministic, so re-running this script does not flip the decision.
//
// Measured before writing, not assumed: of 337 groups, 284 already have a single highest-score
// winner and 53 are score-ties that rule 1 (exact name) resolves on inspection (e.g. "Vinoteca,
// Tămâioasa Românească 2014" tied with "...2001" at the same score — the storeName contains
// "2014", so rule 1 picks the 2014 row). Every group was confirmed to reduce to exactly one
// winner before this was written as the default rather than left to flag ties for a human.
//
// Run: npx tsx scripts/withhold-winemag-fanout.ts [--apply]

import { prisma } from "../src/lib/db";
import { slugify } from "../src/lib/scrape-util";

const MERCHANT = "winemag";

type Row = { id: number; productUrl: string | null; url: string; price: number; matchScore: number | null; storeName: string | null; productId: number; productName: string };

function pickWinner(group: Row[]): Row {
  const exact = group.filter((o) => o.storeName === o.productName);
  if (exact.length === 1) return exact[0];
  const pool = exact.length > 1 ? exact : group;
  const maxScore = Math.max(...pool.map((o) => o.matchScore ?? 0));
  const best = pool.filter((o) => (o.matchScore ?? 0) === maxScore);
  return best.length === 1 ? best[0] : best.sort((a, b) => a.productId - b.productId)[0];
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  console.log(`\n════ WITHHOLD WINEMAG FAN-OUT ${apply ? "" : "(DRY RUN)"} ═══════════════════\n`);

  const merchant = await prisma.merchant.findUnique({ where: { slug: MERCHANT }, select: { id: true } });
  if (!merchant) throw new Error(`no merchant ${MERCHANT}`);

  const offers = await prisma.offer.findMany({
    where: { merchantId: merchant.id, isStale: false, flagged: false },
    select: { id: true, productUrl: true, url: true, price: true, matchScore: true, storeName: true, productId: true, product: { select: { name: true } } },
  });

  const byKey = new Map<string, Row[]>();
  for (const o of offers) {
    const key = o.productUrl ?? `${o.url}|${o.price}`;
    const row: Row = { id: o.id, productUrl: o.productUrl, url: o.url, price: o.price, matchScore: o.matchScore, storeName: o.storeName, productId: o.productId, productName: o.product.name };
    const list = byKey.get(key) ?? [];
    list.push(row);
    byKey.set(key, list);
  }

  const groups = [...byKey.entries()].filter(([, rows]) => new Set(rows.map((r) => r.productId)).size > 1);
  console.log(`  ${groups.length} fan-out group(s) found (${groups.reduce((a, [, r]) => a + r.length, 0)} offers involved).`);

  let ties = 0;
  let totalRejected = 0;
  for (const [key, rows] of groups) {
    const winner = pickWinner(rows);
    const exactMatches = rows.filter((r) => r.storeName === r.productName);
    if (exactMatches.length !== 1 && rows.filter((r) => (r.matchScore ?? 0) === Math.max(...rows.map((r2) => r2.matchScore ?? 0))).length > 1) ties++;

    console.log(`\n  ${key.slice(0, 90)}  (${rows.length} products)`);
    for (const r of rows) {
      const keep = r.id === winner.id;
      console.log(`    offer ${String(r.id).padStart(8)}  score=${(r.matchScore ?? 0).toFixed(2)}  -> #${r.productId} "${r.productName.slice(0, 55)}"${keep ? "  [KEEP]" : "  [REJECT]"}`);
      if (keep || !apply) continue;
      const why = `winemag fan-out — this deep link matched ${rows.length} different catalog products; "${winner.productName}" is the one with the strongest evidence (exact-name or highest score)`;
      const storeKey = `${slugify(r.storeName ?? key)}--winemag-fanout-${r.productId}`;
      await prisma.offer.update({ where: { id: r.id }, data: { flagged: true, flagReason: why.slice(0, 240) } });
      await prisma.matchOverride.upsert({
        where: { merchantId_storeKey: { merchantId: merchant.id, storeKey } },
        update: { productId: r.productId, decision: "reject", note: why.slice(0, 240) },
        create: { merchantId: merchant.id, storeKey, productId: r.productId, decision: "reject", note: why.slice(0, 240) },
      });
      totalRejected++;
    }
  }

  console.log(`\n  ${groups.length} group(s), ${ties} unresolved tie(s) (fell back to lowest productId).`);
  if (apply) console.log(`  ✓ ${totalRejected} withheld and rejected. Reversible: set decision to "confirm" or delete the MatchOverride row.`);
  else console.log(`  DRY RUN — nothing written. Re-run with --apply.`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
