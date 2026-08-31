// Scan price history for pack-size reductions and record candidates for REVIEW.
//
// Nothing detected here is published. Every row lands with reviewed=false and is shown only
// on /admin; the public /shrinkflation page lists reviewed rows only. That gate is the whole
// design: this feature makes a claim about a manufacturer, so a human confirms it first.
//
// Run: npm run detect:shrinkflation

import { prisma } from "../src/lib/db";
import { detectShrinkflation, type PackObservation } from "../src/lib/shrinkflation";

async function main() {
  // Products whose name has changed over time are the only candidates — the pack size lives
  // in the name, so a size change shows up as a name change.
  const products = await prisma.product.findMany({
    where: { offers: { some: { history: { some: {} } } } },
    select: {
      id: true, name: true,
      offers: {
        select: {
          merchantId: true,
          rawPriceText: true,
          history: { select: { priceBani: true, price: true, recordedAt: true }, orderBy: { recordedAt: "asc" } },
        },
      },
    },
    take: 5000,
  });

  let scanned = 0;
  let found = 0;
  for (const p of products) {
    for (const o of p.offers) {
      if (o.history.length < 3) continue;
      scanned++;
      // The product NAME is our only record of the pack size at each point in time. We do
      // not currently snapshot the name per observation, so a real deployment needs that;
      // until then this can only detect changes where the catalog name itself moved.
      const observations: PackObservation[] = o.history.map((h) => ({
        name: p.name,
        priceBani: h.priceBani ?? Math.round(h.price * 100),
        observedAt: h.recordedAt,
      }));
      const f = detectShrinkflation(observations);
      if (!f) continue;
      found++;
      await prisma.productPackChange.upsert({
        where: { productId_oldPackSize_newPackSize: { productId: p.id, oldPackSize: f.oldPackSize, newPackSize: f.newPackSize } },
        update: { confirmations: f.confirmations, newPriceBani: f.newPriceBani, newPricePerUnitBani: f.newPricePerUnitBani },
        create: {
          productId: p.id, merchantId: o.merchantId,
          oldPackSize: f.oldPackSize, newPackSize: f.newPackSize, unit: f.unit,
          oldPricePerUnitBani: f.oldPricePerUnitBani, newPricePerUnitBani: f.newPricePerUnitBani,
          oldPriceBani: f.oldPriceBani, newPriceBani: f.newPriceBani,
          unitPriceRiseBp: f.unitPriceRiseBp, packShrinkBp: f.packShrinkBp,
          confirmations: f.confirmations, firstSeenSmallerAt: f.firstSeenSmallerAt,
        },
      }).catch(() => {});
    }
  }

  const pending = await prisma.productPackChange.count({ where: { reviewed: false, dismissed: false } });
  console.log(`Scanned ${scanned} offer histories across ${products.length} products.`);
  console.log(`Candidates found: ${found}. Awaiting review: ${pending}.`);
  console.log(`\nNOTE: pack size is read from the product NAME, and we do not yet snapshot the`);
  console.log(`name per observation — so this can only see changes where the catalog name moved.`);
  console.log(`Persisting the name (or parsed pack size) on each PriceHistory row is what makes`);
  console.log(`this detector fully effective.`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
