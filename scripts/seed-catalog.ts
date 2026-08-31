// Seeds ONLY the categories (grocery + alcohol). The product catalog itself is built
// from real data by the scrapers (Auchan is the grocery master; alcohol stores build
// the alcohol catalog). No pre-set items, no prices.
import { prisma } from "../src/lib/db";
import { CATEGORIES, ALCOHOL_CATEGORIES } from "../src/data/catalog";

async function main() {
  const all = [...CATEGORIES, ...ALCOHOL_CATEGORIES];
  for (const c of all) {
    const section = c.section ?? "grocery";
    await prisma.category.upsert({
      where: { slug: c.slug },
      update: { name: c.name, icon: c.icon ?? null, section },
      create: { slug: c.slug, name: c.name, icon: c.icon ?? null, section },
    });
  }
  console.log(`Seeded ${CATEGORIES.length} grocery + ${ALCOHOL_CATEGORIES.length} alcohol categories (products come from scrapers).`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
