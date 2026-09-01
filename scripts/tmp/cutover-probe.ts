import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function d(table: string, col: string) {
  const r = await prisma.$queryRawUnsafe<{ v: string | null; n: bigint }[]>(
    `SELECT ${col} AS v, COUNT(*) AS n FROM ${table} GROUP BY ${col} ORDER BY n DESC LIMIT 12`);
  console.log(`  ${table}.${col.padEnd(18)} ${r.map((x) => `${x.v ?? "NULL"}=${Number(x.n)}`).join("  ")}`);
}
async function main() {
  const fk = await prisma.$queryRawUnsafe<{ foreign_keys: number }[]>("PRAGMA foreign_keys");
  console.log(`PRAGMA foreign_keys = ${fk[0]?.foreign_keys}  (0 = SQLite is NOT enforcing any FK)`);
  console.log("\nDISTINCT VALUES IN ENUM-SHAPED COLUMNS (live data):");
  for (const [t, c] of [
    ["Offer", "priceSource"], ["Offer", "availability"], ["Offer", "stockStatus"],
    ["Offer", "vatBasis"], ["Offer", "matchedBy"], ["Offer", "condition"],
    ["Offer", "currency"], ["Offer", "referencePriceKind"], ["Offer", "promoType"],
    ["Merchant", "priceChannel"], ["Merchant", "storeType"],
    ["Product", "section"], ["Product", "unit"], ["Category", "section"],
    ["MatchOverride", "decision"], ["GroceryListItem", "substitutionMode"],
    ["ProductAttribute", "source"], ["UserFavorite", "source"],
    ["PendingMatch", "decision"], ["PendingMatch", "section"],
  ] as const) { try { await d(t, c); } catch (e) { console.log(`  ${t}.${c} — ${(e as Error).message.split("\n")[0]}`); } }

  console.log("\nMONEY COLUMNS — rows that violate the constraint we would want:");
  const q = async (label: string, sql: string) => {
    const r = await prisma.$queryRawUnsafe<{ n: bigint }[]>(sql);
    console.log(`  ${label.padEnd(52)} ${Number(r[0].n)}`);
  };
  await q("Offer.priceBani <= 0 (non-null)", "SELECT COUNT(*) n FROM Offer WHERE priceBani IS NOT NULL AND priceBani <= 0");
  await q("Offer.priceBani IS NULL", "SELECT COUNT(*) n FROM Offer WHERE priceBani IS NULL");
  await q("Offer.price <= 0", "SELECT COUNT(*) n FROM Offer WHERE price <= 0");
  await q("Offer.pricePerUnitBani < 0", "SELECT COUNT(*) n FROM Offer WHERE pricePerUnitBani IS NOT NULL AND pricePerUnitBani < 0");
  await q("Offer.oldPriceBani <= priceBani (a fake strikethrough)", "SELECT COUNT(*) n FROM Offer WHERE oldPriceBani IS NOT NULL AND priceBani IS NOT NULL AND oldPriceBani <= priceBani");
  await q("Offer.lastObservedAt IS NULL and priceSource <> FLYER", "SELECT COUNT(*) n FROM Offer WHERE lastObservedAt IS NULL AND priceSource <> 'FLYER'");
  await q("Offer.lastObservedAt in the future", "SELECT COUNT(*) n FROM Offer WHERE lastObservedAt > datetime('now')");
  await q("Offer.promoValidTo < promoValidFrom", "SELECT COUNT(*) n FROM Offer WHERE promoValidTo IS NOT NULL AND promoValidFrom IS NOT NULL AND promoValidTo < promoValidFrom");
  await q("Product.unitSize <= 0", "SELECT COUNT(*) n FROM Product WHERE unitSize <= 0");
  await q("Offer.matchScore outside 0..1", "SELECT COUNT(*) n FROM Offer WHERE matchScore IS NOT NULL AND (matchScore < 0 OR matchScore > 1)");
  await q("BulkTier.unitPriceBani <= 0", "SELECT COUNT(*) n FROM BulkTier WHERE unitPriceBani <= 0");
  await q("Offer rows whose merchantId has no Merchant (orphan)", "SELECT COUNT(*) n FROM Offer o LEFT JOIN Merchant m ON m.id=o.merchantId WHERE m.id IS NULL");
  await q("Offer rows whose productId has no Product (orphan)", "SELECT COUNT(*) n FROM Offer o LEFT JOIN Product p ON p.id=o.productId WHERE p.id IS NULL");
  await q("PriceHistory rows whose offerId has no Offer (orphan)", "SELECT COUNT(*) n FROM PriceHistory h LEFT JOIN Offer o ON o.id=h.offerId WHERE o.id IS NULL");
  await q("Offer.priceBani disagrees with round(price*100)", "SELECT COUNT(*) n FROM Offer WHERE priceBani IS NOT NULL AND ABS(priceBani - CAST(ROUND(price*100) AS INTEGER)) > 1");
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
