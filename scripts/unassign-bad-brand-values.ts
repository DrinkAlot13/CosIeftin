// Unassign specific brand values `backfill-detail-brands.ts` wrote from a page element that
// was never the product's own brand — CLAUDE.md: "A SCRIPT THAT ASSIGNS MUST BE ABLE TO
// UNASSIGN." A register, not a general "clear anything that looks wrong" rule, because most of
// what a naive "brand not found in the product's own name" check flags turns out to be correct
// (a manufacturer name distinct from the marketed line — Nestle/Chocapic, Vel Pitar/Dor,
// McIlhenny Co./Tabasco — or an apostrophe/spacing mismatch — Hellmann's/Hellmanns, Sano
// Vita/Sanovita). Each entry here was hand-verified as actually wrong, not merely unsupported.
//
// ── "Ceaiuri Twinings" — Carrefour's global "shop by brand" mega-menu (56 `?brand=` links,
//    present on every page from <nav id="navbar-nav">), misread as the CURRENT product's own
//    brand by `brandFromDetailPage`'s rule 3 before it learned to distrust a page carrying more
//    than a handful of brand-shaped links (src/lib/brand/from-detail-page.ts, 2026-09-16).
//    Found live, mid-run, on Riso Scotti rice, De Cecco pasta and 75 other unrelated products;
//    the Carrefour backfill was stopped before it could spread further. Verified: 0 of the 77
//    affected products are actually tea, and the merchant set of every one includes Carrefour.
//
// Run: npx tsx scripts/unassign-bad-brand-values.ts [--apply]

import { prisma } from "../src/lib/db";

const BAD_VALUES: { value: string; source: string; why: string }[] = [
  {
    value: "Ceaiuri Twinings",
    source: "merchant-detail",
    why: "Carrefour's global 'shop by brand' mega-menu, misread as this product's own brand (fixed in from-detail-page.ts's rule 3)",
  },
];

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  console.log(`\n════ UNASSIGN BAD BRAND VALUES ${apply ? "" : "(DRY RUN)"} ═══════════════════════════════\n`);

  let totalCleared = 0;
  for (const bad of BAD_VALUES) {
    const marks = await prisma.productAttribute.findMany({
      where: { key: "brand", value: bad.value, source: bad.source },
      select: { productId: true },
    });
    console.log(`  "${bad.value}" (source=${bad.source}): ${marks.length} product(s)`);
    console.log(`     ${bad.why}`);
    if (marks.length === 0) { console.log(); continue; }

    const sample = await prisma.product.findMany({
      where: { id: { in: marks.slice(0, 5).map((m) => m.productId) } },
      select: { id: true, name: true },
    });
    for (const p of sample) console.log(`       #${p.id} "${p.name.slice(0, 60)}"`);
    console.log();

    if (!apply) continue;
    await prisma.product.updateMany({ where: { id: { in: marks.map((m) => m.productId) } }, data: { brand: null } });
    await prisma.productAttribute.deleteMany({ where: { key: "brand", value: bad.value, source: bad.source } });
    totalCleared += marks.length;
  }

  if (apply) {
    console.log(`  ✓ ${totalCleared} product(s) unassigned. Reversible: re-run backfill:detail-brands for the affected merchant(s).`);
  } else {
    console.log(`  DRY RUN — nothing written. Re-run with --apply.`);
  }
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
