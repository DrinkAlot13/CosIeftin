// Backfill Product.unit / Product.unitSize from the Phase 1a parser, and recompute every
// per-unit price derived from them.
//
// WHY THIS IS NEEDED AT ALL. A re-scrape does not fix existing sizes. The catalog master
// (scrape-auchan) upserts with `update: { image }` only, so a product created a month ago keeps
// whatever size the parser of the day gave it, forever. Every promo-pack correction from Phase
// 1a would apply to newly-created products and to nothing else — and the two readings would sit
// side by side in one table with nothing to say which is which.
//
// This is a CORRECTION, not a deletion. No row is removed; `unit`, `unitSize`, and the
// `pricePerUnit` figures computed from them are recomputed from the product's own name, which
// is the same input the original value came from. Anything the parser cannot read is LEFT
// ALONE rather than nulled — a size we can no longer parse is not evidence the old one was
// wrong.
//
// Run: npm run backfill:unitsize            (dry run — writes nothing, prints the diff)
//      npm run backfill:unitsize -- --apply (writes)

import { PrismaClient } from "@prisma/client";
import { parseQuantity } from "../src/lib/units/parseQuantity";
import { perUnitBaniOrNull } from "../src/lib/price/parsePrice";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

type Change = {
  id: number;
  name: string;
  from: { unit: string; size: number };
  to: { unit: string; size: number };
  offers: number;
};

const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));

async function main(): Promise<void> {
  console.log(APPLY ? "APPLY — this writes.\n" : "DRY RUN — nothing is written. Add --apply to write.\n");

  const products = await prisma.product.findMany({
    select: {
      id: true, name: true, unit: true, unitSize: true, section: true,
      offers: { select: { id: true, price: true, priceBani: true, pricePerUnit: true } },
    },
  });

  const changes: Change[] = [];
  let unparseable = 0;
  let unchanged = 0;
  const bySection = new Map<string, number>();

  for (const p of products) {
    const q = parseQuantity(p.name);
    if (!q) { unparseable++; continue; }
    const unit = q.unit === "BUC" ? "buc" : q.unit === "G" ? "kg" : "l";
    const unitSize = q.unit === "BUC" ? q.value : q.value / 1000;
    // A recomputed size must be positive, or we keep what is there. Writing a zero unitSize
    // would divide by zero in every per-unit price — the exact bug Phase 1a just removed.
    if (!(unitSize > 0)) { unparseable++; continue; }
    if (unit === p.unit && Math.abs(unitSize - p.unitSize) < 1e-9) { unchanged++; continue; }

    changes.push({
      id: p.id, name: p.name,
      from: { unit: p.unit, size: p.unitSize },
      to: { unit, size: unitSize },
      offers: p.offers.length,
    });
    bySection.set(p.section ?? "(none)", (bySection.get(p.section ?? "(none)") ?? 0) + 1);
  }

  const offersTouched = changes.reduce((n, c) => n + c.offers, 0);

  console.log(`  products            ${products.length}`);
  console.log(`  unchanged           ${unchanged}`);
  console.log(`  no parseable size   ${unparseable}  (left alone — an unreadable name is not evidence the old size was wrong)`);
  console.log(`  TO CORRECT          ${changes.length}   affecting ${offersTouched} offers\n`);

  console.log("  BY SECTION");
  for (const [k, n] of [...bySection.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${pad(k, 14)}${String(n).padStart(6)}`);
  }

  console.log("\n  LARGEST CORRECTIONS");
  const ratio = (c: Change): number => {
    if (c.from.unit !== c.to.unit) return Infinity;
    return c.from.size > 0 ? Math.max(c.to.size / c.from.size, c.from.size / c.to.size) : Infinity;
  };
  for (const c of [...changes].sort((a, b) => ratio(b) - ratio(a)).slice(0, 20)) {
    console.log(
      `    ${pad(c.name, 58)}  ${String(c.from.size)} ${pad(c.from.unit, 4)} -> ${c.to.size} ${c.to.unit}` +
      (c.offers ? `  (${c.offers} offers)` : ""),
    );
  }

  if (!APPLY) {
    console.log("\n  DRY RUN — nothing written. Re-run with --apply.\n");
    await prisma.$disconnect();
    return;
  }

  console.log("\n  writing…");
  let written = 0;
  let offersWritten = 0;
  const byId = new Map(products.map((p) => [p.id, p]));
  for (const c of changes) {
    await prisma.product.update({ where: { id: c.id }, data: { unit: c.to.unit, unitSize: c.to.size } });
    written++;
    // Every per-unit price derived from the old size is now wrong by the same factor.
    for (const o of byId.get(c.id)!.offers) {
      const ppu = c.to.size > 0 ? o.price / c.to.size : o.price;
      await prisma.offer.update({
        where: { id: o.id },
        data: { pricePerUnit: ppu, pricePerUnitBani: perUnitBaniOrNull(o.price, c.to.size) },
      });
      offersWritten++;
    }
    if (written % 100 === 0) process.stdout.write(`\r  ${written}/${changes.length} products, ${offersWritten} offers`);
  }
  console.log(`\r  ${written}/${changes.length} products, ${offersWritten} offers        `);

  // Verify: re-read and confirm the parser agrees with what is now stored.
  const recheck = await prisma.product.findMany({
    where: { id: { in: changes.map((c) => c.id) } },
    select: { id: true, name: true, unit: true, unitSize: true },
  });
  let mismatches = 0;
  for (const p of recheck) {
    const q = parseQuantity(p.name)!;
    const unit = q.unit === "BUC" ? "buc" : q.unit === "G" ? "kg" : "l";
    const size = q.unit === "BUC" ? q.value : q.value / 1000;
    if (p.unit !== unit || Math.abs(p.unitSize - size) > 1e-9) mismatches++;
  }
  console.log(`\n  verification: ${recheck.length} products re-read, ${mismatches} mismatch(es)`);
  console.log(mismatches === 0 ? "\n✓ backfill complete and verified\n" : "\n✗ VERIFICATION FAILED\n");

  await prisma.$disconnect();
  if (mismatches > 0) process.exit(1);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
