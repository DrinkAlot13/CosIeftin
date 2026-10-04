// Backfill: 25.6% of live grocery products (11,970 of 46,729) carry no `brand`, even though many
// of their own names lead with a brand word some OTHER product in the catalog already has
// recorded in its `brand` column. A null brand here is not just a missing label — it is the
// reason the matcher falls back to weaker evidence ("name+size" instead of "brand+size"), which
// is exactly the gap the Mega Image coffee fan-out exploited this session (16 different brands'
// worth of coffee wrongly attached to one Jacobs listing, several of which had brand: null).
//
// THE VOCABULARY IS DERIVED, NOT WRITTEN BY HAND — same reasoning as
// propose-class-opportunities.ts's brand set: a hand-written list goes stale and is a second,
// driftable copy of "what is a brand" (CLAUDE.md's "ONE NAMED CONCEPT" section). It is every
// distinct value already sitting in `Product.brand`, normalized.
//
// A match requires the brand to be the LEADING token(s) of the name — not a substring anywhere
// in it, which is how "aro" would have matched inside "Aromat" — and only ever ADDS a brand to a
// row that has none; it never overwrites an existing value.
//
//   npm run backfill:brand                 dry run, prints a sample of proposed assignments
//   npm run backfill:brand -- --apply

import { prisma } from "../src/lib/db";
import { normalizeRo } from "../src/lib/text/normalizeRo";

async function main() {
  const apply = process.argv.includes("--apply");

  const brandRows = await prisma.product.findMany({
    where: { section: "grocery", brand: { not: null } },
    select: { brand: true },
    distinct: ["brand"],
  });
  // Longest first, so a two-word brand ("Fine Life") is tried before its first word alone would
  // otherwise match something unrelated.
  const vocabulary = [...new Set(brandRows.map((b) => normalizeRo(b.brand ?? "")).filter((b) => b.length >= 3))]
    .sort((a, b) => b.split(" ").length - a.split(" ").length || b.length - a.length);

  const candidates = await prisma.product.findMany({
    where: { section: "grocery", brand: null },
    select: { id: true, name: true, slug: true },
  });

  const proposals: { id: number; name: string; brand: string }[] = [];
  for (const p of candidates) {
    const n = normalizeRo(p.name);
    const words = n.split(/\s+/);
    for (const brand of vocabulary) {
      const brandWords = brand.split(" ");
      if (words.slice(0, brandWords.length).join(" ") === brand) {
        // Recover the brand's ORIGINAL casing from the vocabulary source rather than title-
        // casing the normalized form, which would mangle anything with intentional capitalization
        // (LaDorna, KitKat). Re-derive it from one real row carrying that brand.
        proposals.push({ id: p.id, name: p.name, brand });
        break;
      }
    }
  }

  console.log(`${candidates.length} grocery products with no brand; ${proposals.length} match a known brand as their leading word(s).`);
  console.log(`\nSample (first 30):`);
  for (const pr of proposals.slice(0, 30)) console.log(`  "${pr.brand}" <- ${pr.name}`);

  if (!apply) {
    console.log("\nDRY RUN — nothing written. Read the sample, then re-run with --apply.");
    await prisma.$disconnect();
    return;
  }

  // Re-fetch each brand's ORIGINAL casing (the normalized vocabulary loses it) from a real row.
  const originalCasing = new Map<string, string>();
  for (const b of brandRows) {
    const key = normalizeRo(b.brand ?? "");
    if (key && !originalCasing.has(key)) originalCasing.set(key, b.brand!);
  }

  let written = 0;
  for (const pr of proposals) {
    const brand = originalCasing.get(pr.brand) ?? pr.brand;
    await prisma.product.update({ where: { id: pr.id }, data: { brand } });
    written++;
  }
  console.log(`\nWrote brand for ${written} product(s).`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
