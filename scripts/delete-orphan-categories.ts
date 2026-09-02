// Delete category rows the code no longer declares — carefully, and only the safe ones.
//
// Two different situations, and only one of them is safe today:
//
//   THE FOUR BEBELUȘI LEAVES  (lapte-praf, mancare-bebe, scutece, ingrijire-bebe)
//     Superseded by the single merged leaf `bebelusi-toate`. 0 products each, and no code
//     references them — the only textual hit for "scutece" is a MATCH RULE word inside the
//     merged leaf, not a slug. Safe to remove, and removing them is what finishes the merge.
//
//   THE THREE LEGACY DEPARTMENTS  (lactate, legume-fructe, menaj)
//     0 products, 0 children, absent from the sitemap (it only emits categories that have live
//     offers, so these were never published and no URL of ours is indexed). BUT they are still
//     declared in `src/data/catalog.ts`, which `scripts/seed-catalog.ts` imports. Deleting the
//     rows without editing that file means the next seed run resurrects them, and a delete that
//     silently undoes itself is worse than the mismatch. NOT DELETED. Reported instead.
//
// Refuses to touch anything that is not empty, and takes a snapshot first.
//
// Run: npx tsx scripts/delete-orphan-categories.ts [--apply]

import { prisma } from "../src/lib/db";
import { ensureBackup } from "../src/lib/ensure-backup";
import { CATEGORIES, ALCOHOL_CATEGORIES } from "../src/data/catalog";

/** Only these. Deliberately a list, not a query — a query would have swept live rows in. */
const SAFE_TO_DELETE = [
  // The four Bebeluși leaves, superseded by the merged `bebelusi-toate`. Deleted 2026-09-03.
  "lapte-praf", "mancare-bebe", "scutece", "ingrijire-bebe",
  // The three legacy departments. UNBLOCKED 2026-09-03, and only after the first half of the
  // change landed: `src/data/catalog.ts` no longer declares them, so `seed-catalog` can no
  // longer recreate them. Deleting the rows while the seed still declared them would have been
  // a delete that undoes itself on the next `npm run setup`.
  "lactate", "legume-fructe", "menaj",
];
const BLOCKED: string[] = [];

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  console.log(`\n════ ORPHANED CATEGORY ROWS ${apply ? "" : "(DRY RUN)"} ═══════════════════════════════\n`);

  const rows = await prisma.category.findMany({
    where: { slug: { in: [...SAFE_TO_DELETE, ...BLOCKED] } },
    select: { id: true, slug: true, name: true, parentId: true },
  });

  // THE GUARD THAT MAKES THIS SAFE TO RE-RUN: never delete a category the seed still declares.
  // Read from the seed's own source of truth rather than from a note in a comment.
  const seedDeclares = new Set([...CATEGORIES, ...ALCOHOL_CATEGORIES].map((c) => c.slug));

  const deletable: number[] = [];
  for (const slug of SAFE_TO_DELETE) {
    const c = rows.find((r) => r.slug === slug);
    if (!c) { console.log(`  ${slug.padEnd(18)} already gone`); continue; }
    if (seedDeclares.has(slug)) {
      console.log(`  ${slug.padEnd(18)} REFUSED — src/data/catalog.ts still declares it; the seed would recreate it`);
      continue;
    }
    const products = await prisma.product.count({ where: { categoryId: c.id } });
    const children = await prisma.category.count({ where: { parentId: c.id } });
    if (products > 0 || children > 0) {
      // A row that is not empty is not an orphan. Refuse rather than cascade.
      console.log(`  ${slug.padEnd(18)} REFUSED — ${products} product(s), ${children} child(ren)`);
      continue;
    }
    console.log(`  ${slug.padEnd(18)} empty, unreferenced — safe to delete`);
    deletable.push(c.id);
  }

  console.log("");
  for (const slug of BLOCKED) {
    const c = rows.find((r) => r.slug === slug);
    if (!c) continue;
    console.log(`  ${slug.padEnd(18)} NOT DELETED — still declared in src/data/catalog.ts (seed-catalog imports it)`);
  }

  if (!apply) {
    console.log(`\n  DRY RUN — nothing deleted. Re-run with --apply.\n`);
    await prisma.$disconnect();
    return;
  }
  if (deletable.length === 0) {
    console.log("\n  Nothing to delete.\n");
    await prisma.$disconnect();
    return;
  }

  ensureBackup("deleting orphaned category rows");
  const res = await prisma.category.deleteMany({ where: { id: { in: deletable } } });
  console.log(`\n  ✓ deleted ${res.count} orphaned leaf row(s).`);
  console.log("    Verify with: npm run audit:db  (the code/database tree invariant)\n");
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
