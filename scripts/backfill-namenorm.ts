// Backfill Product.nameNorm (diacritic-folded name + brand) for accent-insensitive
// search and matching. Romanian sites mix comma-below ș/ț with the Turkish cedilla ş/ţ,
// which are different codepoints — unfolded, "Făgăraș" and "Făgăraş" never match.
//
// Run: npm run backfill:namenorm

import { prisma } from "../src/lib/db";
import { normalizeText } from "../src/lib/matching";

async function main() {
  const BATCH = 500;
  let skip = 0;
  let updated = 0;
  for (;;) {
    const rows = await prisma.product.findMany({
      select: { id: true, name: true, brand: true, nameNorm: true },
      orderBy: { id: "asc" },
      skip,
      take: BATCH,
    });
    if (rows.length === 0) break;
    for (const p of rows) {
      const want = `${normalizeText(p.name)} ${normalizeText(p.brand ?? "")}`.trim();
      if (p.nameNorm === want) continue;
      await prisma.product.update({ where: { id: p.id }, data: { nameNorm: want } });
      updated++;
    }
    skip += rows.length;
    process.stdout.write(`\r  scanned ${skip}, updated ${updated}`);
  }
  console.log(`\nBackfilled nameNorm on ${updated} products.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
