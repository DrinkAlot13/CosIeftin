// Seeds ONLY the canonical catalog: categories + the pre-set items (no prices).
// Prices/offers come exclusively from the real scrapers (scrape:auchan, scrape:freshful).
import { prisma } from "../src/lib/db";
import { CATEGORIES, ITEMS } from "../src/data/catalog";

async function main() {
  for (const c of CATEGORIES) {
    await prisma.category.upsert({
      where: { slug: c.slug },
      update: { name: c.name, icon: c.icon ?? null },
      create: { slug: c.slug, name: c.name, icon: c.icon ?? null },
    });
  }
  for (const i of ITEMS) {
    const cat = await prisma.category.findUnique({ where: { slug: i.categorySlug } });
    const data = { name: i.name, brand: i.brand ?? null, unit: i.unit, unitSize: i.unitSize, categoryId: cat?.id ?? null };
    await prisma.product.upsert({ where: { slug: i.slug }, update: data, create: { slug: i.slug, ...data } });
  }
  console.log(`Seeded ${CATEGORIES.length} categories + ${ITEMS.length} pre-set items (no prices — prices come from scrapers).`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
