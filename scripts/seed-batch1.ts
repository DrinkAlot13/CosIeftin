// ── SEED PHASE 1b BATCH 1, AND CORRECT TWO EXISTING WINDOWS. Idempotent.
//
// Separate from `seed:equivalence` so the batch can be applied, inspected and reverted on its own
// — the brief reviews classes batch by batch, and a seeder that rewrites all 131 makes "what did
// this batch change" unanswerable.
//
// CLAUDE.md: a script that assigns must be able to unassign. `--remove --write` deletes the
// batch's classes AFTER clearing their assignments, and restores the two corrected windows.
//
//   npm run seed:batch1            # dry run
//   npm run seed:batch1 -- --write
//   npm run seed:batch1 -- --remove --write

import { PrismaClient } from "@prisma/client";
import { BATCH1_CLASSES, WINDOW_CORRECTIONS } from "../src/data/batch1-classes";

const prisma = new PrismaClient();
const PRIOR_KEY = "window:pre-batch1";

async function main(): Promise<void> {
  const write = process.argv.includes("--write");
  const remove = process.argv.includes("--remove");

  if (remove) {
    const slugs = BATCH1_CLASSES.map((k) => k.slug);
    const cls = await prisma.equivalenceClass.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true, _count: { select: { products: true } } } });
    console.log(`REMOVE: ${cls.length} classes, ${cls.reduce((a, c) => a + c._count.products, 0)} assignments.`);
    if (!write) { console.log("  dry run; pass --write."); await prisma.$disconnect(); return; }
    for (const c of cls) {
      await prisma.product.updateMany({ where: { equivalenceClassId: c.id }, data: { equivalenceClassId: null } });
      await prisma.equivalenceClass.delete({ where: { id: c.id } });
    }
    // restore the corrected windows from the saved copy
    for (const w of WINDOW_CORRECTIONS) {
      const saved = await prisma.productAttribute.findFirst({ where: { key: `${PRIOR_KEY}:${w.slug}` }, select: { value: true } });
      if (!saved) continue;
      await prisma.equivalenceClass.update({ where: { slug: w.slug }, data: { attributes: saved.value } });
      await prisma.productAttribute.deleteMany({ where: { key: `${PRIOR_KEY}:${w.slug}` } });
      console.log(`  restored window on ${w.slug}`);
    }
    console.log("  removed.");
    await prisma.$disconnect();
    return;
  }

  console.log("═".repeat(92));
  console.log(`  PHASE 1b BATCH 1 — ${BATCH1_CLASSES.length} classes, ${WINDOW_CORRECTIONS.length} window corrections. ${write ? "WRITING" : "DRY RUN"}`);
  console.log("═".repeat(92));
  for (const k of BATCH1_CLASSES) {
    const a = k.attributes as { minUnitSize?: number; maxUnitSize?: number; require?: string[] };
    console.log(`  ${k.slug.padEnd(24)} ${k.unit} ${String(k.unitSize).padEnd(6)} window ${a.minUnitSize}-${a.maxUnitSize}  require ${JSON.stringify(a.require)}`);
    if (!write) continue;
    await prisma.equivalenceClass.upsert({
      where: { slug: k.slug },
      create: { slug: k.slug, label: k.label, section: "grocery", unit: k.unit, unitSize: k.unitSize, attributes: JSON.stringify(k.attributes) },
      update: { label: k.label, unit: k.unit, unitSize: k.unitSize, attributes: JSON.stringify(k.attributes) },
    });
  }

  console.log(`\n  WINDOW CORRECTIONS (the prior value is saved so --remove can put it back):`);
  for (const w of WINDOW_CORRECTIONS) {
    const c = await prisma.equivalenceClass.findUnique({ where: { slug: w.slug }, select: { id: true, attributes: true } });
    if (!c) { console.log(`    ${w.slug}: NOT FOUND — skipped`); continue; }
    const attrs = JSON.parse(c.attributes ?? "{}") as Record<string, unknown>;
    console.log(`    ${w.slug}: minUnitSize ${attrs.minUnitSize} → ${w.minUnitSize}   (${w.why})`);
    if (!write) continue;
    // Save the ORIGINAL attributes JSON verbatim before touching it.
    const anyProduct = await prisma.product.findFirst({ where: { equivalenceClassId: c.id }, select: { id: true } });
    if (anyProduct) {
      await prisma.productAttribute.upsert({
        where: { productId_key: { productId: anyProduct.id, key: `${PRIOR_KEY}:${w.slug}` } },
        create: { productId: anyProduct.id, key: `${PRIOR_KEY}:${w.slug}`, value: c.attributes ?? "{}", source: "human", confidence: 1 },
        update: { value: c.attributes ?? "{}" },
      });
    }
    attrs.minUnitSize = w.minUnitSize;
    await prisma.equivalenceClass.update({ where: { id: c.id }, data: { attributes: JSON.stringify(attrs) } });
  }

  console.log(write ? `\n  WRITTEN. Now: npm run propose:equivalence -- --apply` : `\n  DRY RUN. Nothing written.`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
