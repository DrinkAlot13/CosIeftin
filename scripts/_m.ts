import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
(async () => {
  const ms = await prisma.merchant.findMany({ select: { slug: true, name: true, active: true, _count: { select: { offers: true } } }, orderBy: { slug: "asc" } });
  for (const m of ms) console.log(`  ${m.slug.padEnd(18)} active=${String(m.active).padEnd(5)} offers=${m._count.offers}`);
  console.log("\n  merchants with >0 offers: " + ms.filter((m) => m._count.offers > 0).length);
  console.log("  active AND >0 offers:     " + ms.filter((m) => m.active && m._count.offers > 0).length);
  await prisma.$disconnect();
})();
