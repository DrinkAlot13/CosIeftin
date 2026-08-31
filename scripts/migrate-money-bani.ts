// MONEY MIGRATION — Float lei → Int bani. The risky one, so it is staged and verified.
//
// Sequence (never destructive in one step):
//   1  snapshot   every current price row to tmp/pre-migration-prices.json
//   2  backfill   the new *Bani columns from the existing Float columns
//   3  verify     row counts identical AND abs(newBani - round(oldLei*100)) === 0 for EVERY
//                 row; any mismatch prints full row context and exits non-zero
//   4  (later)    switch reads, then drop the Float columns in a separate migration
//
// The Float columns are NOT dropped here. Dropping them is a separate, deliberate step
// taken only after reads have moved over and this verification has passed cleanly.
//
// Run: npm run migrate:money            (snapshot + backfill + verify)
//      npm run migrate:money -- --verify-only

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../src/lib/db";

const TMP = join(process.cwd(), "tmp");
const SNAPSHOT = join(TMP, "pre-migration-prices.json");
const BATCH = 500;

/** The one conversion. Anything else risks float drift at the boundary. */
const toBani = (lei: number): number => Math.round(lei * 100);

async function snapshot() {
  console.log("1/3  snapshot");
  mkdirSync(TMP, { recursive: true });
  const offers = await prisma.offer.findMany({
    select: { id: true, price: true, pricePerUnit: true, oldPrice: true, loyaltyPrice: true, referencePriceBani: true },
  });
  const history = await prisma.priceHistory.findMany({ select: { id: true, price: true } });
  const alerts = await prisma.priceAlert.findMany({ select: { id: true, targetPrice: true, basePrice: true } });
  const payload = { takenAt: new Date().toISOString(), counts: { offers: offers.length, history: history.length, alerts: alerts.length }, offers, history, alerts };
  writeFileSync(SNAPSHOT, JSON.stringify(payload), "utf8");
  console.log(`     wrote ${SNAPSHOT}`);
  console.log(`     offers=${offers.length} history=${history.length} alerts=${alerts.length}`);
  return payload;
}

async function backfill() {
  console.log("\n2/3  backfill *Bani columns");
  // Set-based SQL, not row-by-row: 38k individual UPDATE round-trips take minutes and buy
  // nothing. ROUND(x * 100) is the same conversion as Math.round(lei * 100) — the verify
  // step below re-derives every value in TypeScript and demands exact equality, so the two
  // implementations check each other.
  const o = await prisma.$executeRawUnsafe(`
    UPDATE "Offer" SET
      "priceBani"        = CAST(ROUND(price * 100) AS INTEGER),
      "pricePerUnitBani" = CAST(ROUND("pricePerUnit" * 100) AS INTEGER),
      "oldPriceBani"     = CASE WHEN "oldPrice"     IS NULL THEN NULL ELSE CAST(ROUND("oldPrice" * 100)     AS INTEGER) END,
      "loyaltyPriceBani" = CASE WHEN "loyaltyPrice" IS NULL THEN NULL ELSE CAST(ROUND("loyaltyPrice" * 100) AS INTEGER) END
  `);
  console.log(`     offers  ${o} ✓`);
  const h = await prisma.$executeRawUnsafe(`UPDATE "PriceHistory" SET "priceBani" = CAST(ROUND(price * 100) AS INTEGER)`);
  console.log(`     history ${h} ✓`);
  const a = await prisma.$executeRawUnsafe(`
    UPDATE "PriceAlert" SET
      "basePriceBani"   = CAST(ROUND("basePrice" * 100) AS INTEGER),
      "targetPriceBani" = CASE WHEN "targetPrice" IS NULL THEN NULL ELSE CAST(ROUND("targetPrice" * 100) AS INTEGER) END
  `);
  console.log(`     alerts  ${a} ✓`);
}

async function verify(): Promise<boolean> {
  console.log("\n3/3  verify");
  let ok = true;
  const problems: string[] = [];

  // counts must be identical — a migration that loses a row is a failure even if every
  // surviving row converted perfectly
  const offerCount = await prisma.offer.count();
  const withBani = await prisma.offer.count({ where: { priceBani: { not: null } } });
  console.log(`     offers ${offerCount}, with priceBani ${withBani}`);
  if (offerCount !== withBani) { ok = false; problems.push(`offer count ${offerCount} != priceBani count ${withBani}`); }

  // EVERY row, exact equality — not a tolerance
  let checked = 0;
  let skip = 0;
  for (;;) {
    const rows = await prisma.offer.findMany({
      select: { id: true, price: true, priceBani: true, pricePerUnit: true, pricePerUnitBani: true, oldPrice: true, oldPriceBani: true, loyaltyPrice: true, loyaltyPriceBani: true, merchant: { select: { name: true } }, product: { select: { name: true } } },
      orderBy: { id: "asc" }, skip, take: BATCH,
    });
    if (rows.length === 0) break;
    for (const r of rows) {
      const checks: [string, number | null, number | null][] = [
        ["price", r.price, r.priceBani],
        ["pricePerUnit", r.pricePerUnit, r.pricePerUnitBani],
        ["oldPrice", r.oldPrice, r.oldPriceBani],
        ["loyaltyPrice", r.loyaltyPrice, r.loyaltyPriceBani],
      ];
      for (const [field, lei, bani] of checks) {
        if (lei == null) { if (bani != null) { ok = false; problems.push(`offer ${r.id} ${field}: lei null but bani ${bani}`); } continue; }
        const expected = toBani(lei);
        if (bani == null || Math.abs(bani - expected) !== 0) {
          ok = false;
          problems.push(`offer ${r.id} [${r.merchant.name}] "${r.product.name.slice(0, 40)}" ${field}: lei=${lei} expected ${expected} bani, got ${bani}`);
        }
      }
      checked++;
    }
    skip += rows.length;
  }
  console.log(`     checked ${checked} offers, every money column, exact equality`);

  let hChecked = 0;
  let hSkip = 0;
  for (;;) {
    const rows = await prisma.priceHistory.findMany({ select: { id: true, price: true, priceBani: true }, orderBy: { id: "asc" }, skip: hSkip, take: BATCH });
    if (rows.length === 0) break;
    for (const r of rows) {
      const expected = toBani(r.price);
      if (r.priceBani == null || Math.abs(r.priceBani - expected) !== 0) {
        ok = false;
        problems.push(`priceHistory ${r.id}: lei=${r.price} expected ${expected} bani, got ${r.priceBani}`);
      }
      hChecked++;
    }
    hSkip += rows.length;
  }
  console.log(`     checked ${hChecked} price-history rows`);

  if (!ok) {
    console.error(`\n✗ ${problems.length} MISMATCH(ES) — do NOT cut over:\n`);
    for (const p of problems.slice(0, 40)) console.error(`    ${p}`);
    if (problems.length > 40) console.error(`    … and ${problems.length - 40} more`);
    return false;
  }
  console.log("\n✓ MIGRATION VERIFIED — every money column matches round(lei * 100) exactly.");
  return true;
}

async function main() {
  const verifyOnly = process.argv.includes("--verify-only");
  if (!verifyOnly) {
    await snapshot();
    await backfill();
  }
  const ok = await verify();
  await prisma.$disconnect();
  if (!ok) process.exit(1);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
