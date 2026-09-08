// ── SCOPE: THE HALF THE QUEUE DIFF CANNOT SEE. READ-ONLY. ─────────────────────
// DID THE BRAND-AWARE HEAD NOUN CHANGE WHICH PAIRS EVEN BECOME CANDIDATES?
//
// ── WHY THE OBVIOUS MEASUREMENT IS THE WRONG ONE, and it took a wrong answer to notice.
//
// `diff:descriptors` re-decides every queued pair, and on the head-noun change it reported
// **938 matches before, 930 after** — the fix looking like a small net LOSS.
//
// That population is selected by the very thing being changed. A pair is in `PendingMatch`
// only because it BECAME A CANDIDATE, and candidates were selected by the OLD head noun: the
// store item had to contain the catalog row's first significant token, which for a brand-first
// row is the BRAND. So the queue contains only pairs where the merchant DID write the brand,
// and on those the new rule is strictly harder — it now also demands the real noun.
//
// The pairs the fix exists for are, by construction, absent: they never became candidates, so
// nothing was ever queued about them, so no diff over the queue can find them. Measuring only
// the queue measures only the half where this change can hurt.
//
// ── WHAT THIS DOES INSTEAD.
//
// Rebuilds `matchPoolToCatalog`'s candidate index — store items keyed by every significant
// token — using live offers as a stand-in pool, and asks each catalog row for its candidates
// under BOTH head nouns. Then runs the REAL `decide()` on what is newly reachable, because
// "more candidates" is not a benefit; more candidates that MATCH is.
//
// ── WHAT IT IS NOT. Live offers are a stand-in for a scrape pool, not the pool itself: they
// are what SURVIVED matching, so an item that matched nothing and was never turned into a
// product is not here. That biases this measure DOWNWARD and it is stated rather than buried.
//
//   npm run audit:candidate-reach
//   npm run audit:candidate-reach -- --sample=30

import { PrismaClient } from "@prisma/client";
import { prep, headNoun, decide } from "../src/lib/scrape-util";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();
const MAX_AGE = 14 * 86_400_000;
/** No catalog row is compared against more than this many candidates, matching the shape of
 *  the real index rather than letting one common noun dominate the run. */
const MAX_CANDIDATES = 400;

async function main(): Promise<void> {
  const a = process.argv.find((x) => x.startsWith("--sample="));
  const SAMPLE = a ? Number(a.split("=")[1]) : 30;

  const cutoff = new Date(Date.now() - MAX_AGE);
  const offers = await prisma.offer.findMany({
    where: {
      merchant: { active: true }, availability: "in stock", isStale: false, flagged: false,
      lastObservedAt: { gte: cutoff }, storeName: { not: null },
      product: { section: "grocery" },
    },
    select: {
      storeName: true, ownUnit: true, ownUnitSize: true, productId: true,
      merchant: { select: { slug: true } },
      product: { select: { unit: true, unitSize: true } },
    },
  });

  type PoolItem = {
    merchant: string; name: string; unit: string; unitSize: number; productId: number;
    item: ReturnType<typeof prep>;
  };
  const pool: PoolItem[] = offers.map((o) => ({
    merchant: o.merchant.slug,
    name: o.storeName as string,
    unit: o.ownUnitSize && o.ownUnitSize > 0 ? (o.ownUnit ?? o.product.unit) : o.product.unit,
    unitSize: o.ownUnitSize && o.ownUnitSize > 0 ? o.ownUnitSize : o.product.unitSize,
    productId: o.productId,
    // The pool carries no brand field for most merchants — `Offer` has no `storeBrand` column —
    // so the store side is prepped from its own name alone, as the scraper hands it over.
    item: prep(o.storeName as string, null, null),
  }));

  // The candidate index, exactly as `matchPoolToCatalog` builds it: every significant token.
  const byToken = new Map<string, PoolItem[]>();
  for (const p of pool) {
    for (const t of p.item.tokens) {
      const l = byToken.get(t);
      if (l) l.push(p); else byToken.set(t, [p]);
    }
  }

  const products = await prisma.product.findMany({
    where: { section: "grocery", brand: { not: null } },
    select: { id: true, name: true, brand: true, unit: true, unitSize: true },
  });

  let changed = 0, gainedRows = 0, newlyReachable = 0, newlyMatching = 0, lostRows = 0, lostReachable = 0;
  const examples: string[] = [];
  const byMerchant = new Map<string, number>();

  for (const p of products) {
    const cItem = prep(p.name, p.brand, null);
    const oldHead = headNoun(cItem.nname);
    const newHead = headNoun(cItem.nname, cItem.nbrand);
    if (oldHead === newHead) continue;
    changed++;

    const before = new Set(byToken.get(oldHead) ?? []);
    const after = byToken.get(newHead) ?? [];
    const gained = after.filter((x) => !before.has(x)).slice(0, MAX_CANDIDATES);
    const lost = [...before].filter((x) => !(byToken.get(newHead) ?? []).includes(x));
    if (gained.length > 0) gainedRows++;
    if (lost.length > 0) { lostRows++; lostReachable += lost.length; }
    newlyReachable += gained.length;

    const cSize = { unit: p.unit, unitSize: p.unitSize };
    for (const g of gained) {
      if (g.productId === p.id) continue; // already this product's own offer
      const d = decide(cItem, cSize, g.item, { unit: g.unit, unitSize: g.unitSize }, "grocery");
      if (!d.ok) continue;
      newlyMatching++;
      byMerchant.set(g.merchant, (byMerchant.get(g.merchant) ?? 0) + 1);
      if (examples.length < SAMPLE) {
        examples.push(
          `  ${g.merchant.padEnd(14)} score ${d.score.toFixed(2)}  [${oldHead} -> ${newHead}]\n` +
          `     catalog: ${p.name.slice(0, 66)}\n` +
          `     store:   ${g.name.slice(0, 66)}`,
        );
      }
    }
  }

  console.log("═".repeat(100));
  console.log("CANDIDATE REACH — what the brand-aware head noun makes VISIBLE to the matcher");
  console.log("═".repeat(100));
  console.log(`  live grocery offers used as a stand-in pool   ${pool.length}`);
  console.log(`  branded grocery catalog rows                  ${products.length}`);
  console.log(`  rows whose head noun CHANGED                  ${changed}`);
  console.log(`  ...of which gained candidates                 ${gainedRows}`);
  console.log(`  ...of which lost candidates                   ${lostRows}`);
  console.log(`\n  newly reachable (row, store item) pairs       ${newlyReachable}`);
  console.log(`  NEWLY REACHABLE **AND** ACCEPTED by decide()   ${newlyMatching}`);
  console.log(`\n  WHAT A SWAP WOULD HAVE COST                   ${lostReachable} pairs unreachable`);
  console.log(`  This is why candidate selection takes the UNION of both head nouns rather than`);
  console.log(`  replacing one with the other. Indexing a brand-first row on its BRAND returns a`);
  console.log(`  tightly brand-scoped candidate set — asking for "milka" beats asking for`);
  console.log(`  "ciocolata" — so the old key was doing useful work by accident. In production`);
  console.log(`  nothing is lost: both keys are looked up. The figure above is the counterfactual.`);

  if (byMerchant.size > 0) {
    console.log(`\n  BY MERCHANT — the ones that omit brands should dominate, and that is the test:`);
    for (const [m, n] of [...byMerchant.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${m.padEnd(16)} ${String(n).padStart(6)}`);
    }
  }

  console.log(`\n${"─".repeat(100)}`);
  console.log(`${Math.min(SAMPLE, examples.length)} NEWLY MATCHED PAIRS TO READ`);
  console.log("─".repeat(100));
  for (const e of examples) console.log(e);
  if (examples.length === 0) console.log(`  NONE — the change reaches no new matching pair in this pool.`);

  console.log(`\n  Read these. Whether each is one product is a judgement about what people buy,`);
  console.log(`  and per CLAUDE.md no query settles it.`);

  emitJson({
    pool: pool.length, products: products.length,
    headNounChanged: changed, gainedRows, lostRows,
    newlyReachable, lostReachable, newlyMatching,
    byMerchant: [...byMerchant.entries()].map(([merchant, n]) => ({ merchant, n })),
    pass: true,
  });
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
