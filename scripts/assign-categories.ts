// Populate the grocery tree: RECOVER what merchants told us, then assign the rest by name.
//
// Dry run by default. Assignment is proposed and printed before it is written, for the same
// reason `propose:equivalence` is: a wrong category is worse than none, and reading the table is
// the review step.
//
// Run: npm run assign:categories             (dry run)
//      npm run assign:categories -- --apply  (writes, after you have read the table)

import { prisma } from "../src/lib/db";
import { assignByMerchantPath, assignByName, type Assignment } from "../src/lib/category/assign";
import { recoverPath } from "../src/lib/category/recover";
import { GROCERY_TREE, ALL_LEAVES } from "../src/lib/category/tree";

const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const lp = (s: string | number, n: number) => String(s).padStart(n);

async function ensureTree(apply: boolean): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  for (const dept of GROCERY_TREE) {
    let d = await prisma.category.findUnique({ where: { slug: dept.slug } });
    if (!d && apply) {
      d = await prisma.category.create({ data: { slug: dept.slug, name: dept.label, section: "grocery", icon: dept.icon } });
    }
    if (d) ids.set(dept.slug, d.id);
    for (const leaf of dept.children) {
      let l = await prisma.category.findUnique({ where: { slug: leaf.slug } });
      if (!l && apply && d) {
        l = await prisma.category.create({ data: { slug: leaf.slug, name: leaf.label, section: "grocery", parentId: d.id } });
      } else if (l && apply && d && l.parentId !== d.id) {
        l = await prisma.category.update({ where: { id: l.id }, data: { parentId: d.id, name: leaf.label, section: "grocery" } });
      }
      if (l) ids.set(leaf.slug, l.id);
    }
  }
  return ids;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  const products = await prisma.product.findMany({
    where: { section: "grocery" },
    select: {
      id: true, name: true, categoryId: true,
      offers: {
        select: {
          rawSourceBlob: true, productUrl: true, url: true, categoryPath: true,
          merchant: { select: { slug: true } },
        },
      },
    },
  });

  console.log(`\n════ GROCERY CATEGORISATION ═════════════════════════════════════════════════`);
  console.log(`  ${products.length} grocery products · tree: ${GROCERY_TREE.length} departments, ${ALL_LEAVES.length} leaves\n`);

  type Row = { id: number; name: string; a: Assignment; via: "recovered" | "name" };
  const decided: Row[] = [];
  const review: Row[] = [];
  const none: { id: number; name: string; reason: string }[] = [];
  let recoveredCount = 0;

  for (const p of products) {
    // ── STAGE 1: what did a merchant already tell us?
    let a: Assignment | null = null;
    let via: "recovered" | "name" = "name";
    for (const o of p.offers) {
      const rp = recoverPath({
        merchantSlug: o.merchant.slug, rawSourceBlob: o.rawSourceBlob,
        productUrl: o.productUrl, url: o.url, categoryPath: o.categoryPath,
      });
      if (!rp) continue;
      const cand = assignByMerchantPath(rp.levels);
      if (cand.leafSlug) { a = cand; via = "recovered"; recoveredCount++; break; }
    }
    // ── STAGE 2: otherwise infer from the name.
    if (!a) a = assignByName(p.name);

    if (a.band === "AUTO") decided.push({ id: p.id, name: p.name, a, via });
    else if (a.band === "REVIEW") review.push({ id: p.id, name: p.name, a, via });
    else none.push({ id: p.id, name: p.name, reason: a.reason });
  }

  const total = products.length;
  const pct = (n: number) => ((n / total) * 100).toFixed(1) + "%";
  console.log(`  STAGE 1 — recovered from a merchant path : ${lp(recoveredCount, 6)}  ${pct(recoveredCount)}`);
  console.log(`  STAGE 2 — assigned by name (AUTO)        : ${lp(decided.length - recoveredCount, 6)}  ${pct(decided.length - recoveredCount)}`);
  console.log(`  ────────────────────────────────────────────────────────`);
  console.log(`  ASSIGNED (written)                       : ${lp(decided.length, 6)}  ${pct(decided.length)}`);
  console.log(`  IN REVIEW (proposed, not written)        : ${lp(review.length, 6)}  ${pct(review.length)}`);
  console.log(`  UNASSIGNED                               : ${lp(none.length, 6)}  ${pct(none.length)}`);

  // ── where the assigned ones landed
  const byLeaf = new Map<string, number>();
  for (const d of decided) byLeaf.set(d.a.leafSlug!, (byLeaf.get(d.a.leafSlug!) ?? 0) + 1);
  console.log(`\n  BY DEPARTMENT`);
  for (const dept of GROCERY_TREE) {
    const n = dept.children.reduce((s, c) => s + (byLeaf.get(c.slug) ?? 0), 0);
    console.log(`  ${dept.icon} ${pad(dept.label, 24)}${lp(n, 7)}`);
    for (const c of dept.children) {
      const cn = byLeaf.get(c.slug) ?? 0;
      if (cn > 0) console.log(`       ${pad(c.label, 30)}${lp(cn, 6)}`);
    }
  }

  console.log(`\n  WHY THE UNASSIGNED FAILED (top reasons)`);
  const reasons = new Map<string, number>();
  for (const n of none) reasons.set(n.reason, (reasons.get(n.reason) ?? 0) + 1);
  for (const [r, n] of [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`    ${lp(n, 6)}  ${r}`);
  console.log(`\n  SAMPLE OF UNASSIGNED NAMES`);
  for (const n of none.slice(0, 12)) console.log(`    ${n.name.slice(0, 76)}`);

  if (!apply) {
    console.log(`\n  DRY RUN — nothing written. Re-run with --apply after reading the table.\n`);
    await prisma.$disconnect();
    return;
  }

  const ids = await ensureTree(true);

  // DEPARTMENT SLUGS COLLIDE WITH THE OLD FLAT CATEGORIES ("bacanie", "bauturi"), so reusing
  // them as departments leaves the old rows' products sitting ON a department. A department is
  // not a place a product belongs — every product goes on a leaf — so clear those first and let
  // the assigner place them, or leave them honestly unassigned.
  // Any PARENTLESS grocery category is a department or a legacy flat row; neither is a place a
  // product belongs. Clearing by the invariant rather than by our own slug list also catches the
  // seven old flat categories whose slugs do not collide with ours — 262 products were still
  // sitting on those after the first pass.
  const parentless = await prisma.category.findMany({
    where: { section: "grocery", parentId: null },
    select: { id: true },
  });
  const cleared = await prisma.product.updateMany({
    where: { section: "grocery", categoryId: { in: parentless.map((c) => c.id) } },
    data: { categoryId: null },
  });
  if (cleared.count) console.log(`
  cleared ${cleared.count} product(s) that sat on a department rather than a leaf`);

  // A CORRECTION MUST BE ABLE TO REMOVE A WRONG ASSIGNMENT, not just add a right one.
  //
  // Without this the apply step was write-only: after tightening the rules so that adult
  // incontinence pads no longer match Bebeluși > Scutece, they stayed there — the products had
  // dropped to NONE, and NONE writes nothing, so the previous run's mistake survived every
  // subsequent run. Any grocery product this run does not place on a leaf gets cleared first.
  const keepIds = new Set(decided.map((d) => d.id));
  const stale = await prisma.product.findMany({
    where: { section: "grocery", categoryId: { not: null } },
    select: { id: true },
  });
  const toClear = stale.filter((p) => !keepIds.has(p.id)).map((p) => p.id);
  if (toClear.length) {
    await prisma.product.updateMany({ where: { id: { in: toClear } }, data: { categoryId: null } });
    console.log(`  cleared ${toClear.length} assignment(s) this run no longer stands behind`);
  }

  let written = 0;
  for (const d of decided) {
    const cid = ids.get(d.a.leafSlug!);
    if (!cid) continue;
    await prisma.product.update({ where: { id: d.id }, data: { categoryId: cid } });
    written++;
  }
  console.log(`\n  ✓ wrote ${written} category assignments across ${ids.size} categories.`);
  console.log(`    ${review.length} left in REVIEW and ${none.length} unassigned — neither was written.\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
