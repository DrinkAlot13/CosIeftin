// Store economics: how you can buy, what delivery costs, and the minimum order.
// The basket optimizer needs these to be honest — a "cheapest basket" that ignores a
// 20-lei delivery fee, or that recommends a store whose minimum order you don't meet,
// is simply wrong.
//
// These are published, slow-moving commercial terms; keep them reviewed rather than
// scraped. Re-run any time: it's idempotent.
//
// Run: npm run set-store-economics

import { prisma } from "../src/lib/db";

type Econ = {
  storeType: "online" | "hybrid" | "physical";
  priceSource: "shelf" | "delivery" | "aggregator";
  deliveryFee?: number;
  freeDeliveryOver?: number;
  minOrder?: number;
};

// Reviewed 2026-08-30. Fees are the standard Bucharest rate where a store varies by city.
const ECON: Record<string, Econ> = {
  // pure online / delivery
  freshful:     { storeType: "online",   priceSource: "delivery", deliveryFee: 14.9, freeDeliveryOver: 200, minOrder: 50 },
  sezamo:       { storeType: "online",   priceSource: "delivery", deliveryFee: 14.9, freeDeliveryOver: 250, minOrder: 75 },
  dcneu:        { storeType: "online",   priceSource: "delivery", deliveryFee: 19.9, freeDeliveryOver: 300 },
  finestore:    { storeType: "online",   priceSource: "shelf",    deliveryFee: 25,   freeDeliveryOver: 500 },
  lemanoir:     { storeType: "online",   priceSource: "shelf",    deliveryFee: 25,   freeDeliveryOver: 500 },
  farmaciatei:  { storeType: "hybrid",   priceSource: "shelf",    deliveryFee: 15,   freeDeliveryOver: 150 },
  douglas:      { storeType: "online",   priceSource: "shelf",    deliveryFee: 20,   freeDeliveryOver: 200 },

  // hybrid: shop in store, or order online
  auchan:       { storeType: "hybrid",   priceSource: "shelf",    deliveryFee: 19.9, freeDeliveryOver: 250, minOrder: 50 },
  carrefour:    { storeType: "hybrid",   priceSource: "shelf",    deliveryFee: 19.9, freeDeliveryOver: 250, minOrder: 50 },
  "mega-image": { storeType: "hybrid",   priceSource: "shelf",    deliveryFee: 16.9, freeDeliveryOver: 200, minOrder: 40 },
  metro:        { storeType: "hybrid",   priceSource: "shelf",    deliveryFee: 25,   freeDeliveryOver: 400 },
  selgros:      { storeType: "hybrid",   priceSource: "shelf",    deliveryFee: 25,   freeDeliveryOver: 400 },

  // physical only — no delivery, so no fee and no minimum
  kaufland:     { storeType: "physical", priceSource: "shelf" },
  penny:        { storeType: "physical", priceSource: "shelf" },
  lidl:         { storeType: "physical", priceSource: "shelf" },
  profi:        { storeType: "physical", priceSource: "shelf" },
};

async function main() {
  const merchants = await prisma.merchant.findMany({ select: { id: true, slug: true, name: true } });
  let updated = 0;
  const unknown: string[] = [];
  for (const m of merchants) {
    const e = ECON[m.slug];
    if (!e) { unknown.push(m.slug); continue; }
    await prisma.merchant.update({
      where: { id: m.id },
      data: {
        storeType: e.storeType,
        priceSource: e.priceSource,
        deliveryFee: e.deliveryFee ?? null,
        freeDeliveryOver: e.freeDeliveryOver ?? null,
        minOrder: e.minOrder ?? null,
      },
    });
    const fee = e.deliveryFee ? `${e.deliveryFee} lei${e.freeDeliveryOver ? ` (gratis >${e.freeDeliveryOver})` : ""}` : "fara livrare";
    console.log(`  ${m.name.padEnd(16)} ${e.storeType.padEnd(9)} ${e.priceSource.padEnd(10)} ${fee}`);
    updated++;
  }
  if (unknown.length) console.log(`\n  (no economics defined yet: ${unknown.join(", ")})`);
  console.log(`\nUpdated ${updated} merchants.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
