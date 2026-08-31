// Sets how each store can be bought from (online / hybrid / physical) so the site can
// tell shoppers e.g. "Freshful e doar online". Run once after the schema change:
//   npm run set-store-types
import { prisma } from "../src/lib/db";

const TYPES: Record<string, string> = {
  // online-only delivery / e-shops
  freshful: "online",
  sezamo: "online",
  finestore: "online",
  lemanoir: "online",
  dcneu: "online",
  farmaciatei: "online",
  douglas: "online",
  // chains with physical stores AND online ordering
  auchan: "hybrid",
  carrefour: "hybrid",
  "mega-image": "hybrid",
  metro: "hybrid",
};

async function main() {
  for (const [slug, storeType] of Object.entries(TYPES)) {
    await prisma.merchant.updateMany({ where: { slug }, data: { storeType } });
  }
  console.log(`Set store types for ${Object.keys(TYPES).length} merchants.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
