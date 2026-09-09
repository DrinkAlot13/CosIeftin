// ── WITHHOLD PER-UNIT PRICES NOBODY COULD PAY. WRITES.
//
// The bound now lives in `lib/price/unit-price-bounds.ts` and the scrape write path applies it,
// so no NEW offer can acquire one. This clears the ones already stored — 28 at the time of
// writing, the worst a nicotine spray at 86,500,000 lei/kg.
//
// ── WHAT IT DOES AND POINTEDLY DOES NOT DO.
//
//   WITHHELD  `pricePerUnit` and `pricePerUnitBani`, which are the wrong numbers.
//   KEPT      the PRICE, which is right in every case examined against the merchant's own page.
//
// Withholding the offer would remove a price we can stand behind because its SIZE is wrong.
// A GATE DEFERS; IT NEVER DISCARDS — and every clearing is written to `PriceAnomaly` through
// `record-refusal`, the one writer, so the size can be fixed rather than forgotten.
//
// ── IT CAN UNASSIGN, because CLAUDE.md requires that of anything that assigns.
//
// The rule may loosen — a ceiling is a judgement and judgements move. So the run also RESTORES
// a unit price it previously withheld when the current bound accepts it: it recomputes from the
// offer's own size and writes it back. Without that, a relaxed bound would leave every
// previously-cleared row at zero forever and nothing would say so.
//
//   npm run withhold:unit-prices -- --dry
//   npm run withhold:unit-prices

import { PrismaClient } from "@prisma/client";
import { unitPriceRefusal, isPriceUnit } from "../src/lib/price/unit-price-bounds";
import { recordRefusal } from "../src/lib/record-refusal";
import { perUnitBaniOrNull } from "../src/lib/price/parsePrice";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const dry = process.argv.includes("--dry");

  const offers = await prisma.offer.findMany({
    where: { merchant: { active: true } },
    select: {
      id: true, price: true, priceBani: true, pricePerUnit: true, pricePerUnitBani: true,
      ownUnit: true, ownUnitSize: true, storeName: true, rawPriceText: true, merchantId: true,
      merchant: { select: { slug: true } },
      product: { select: { name: true, unit: true, unitSize: true } },
    },
  });

  type Row = { id: number; merchant: string; name: string; ppu: number; unit: string; size: number };
  const withheld: Row[] = [];
  const restored: Row[] = [];

  for (const o of offers) {
    // The unit the per-unit price is quoted in: the offer's own when it has one, else the row's.
    const unit = ((o.ownUnitSize && o.ownUnitSize > 0 ? o.ownUnit : o.product.unit) ?? o.product.unit).toLowerCase();
    if (!isPriceUnit(unit)) continue;
    const size = o.ownUnitSize && o.ownUnitSize > 0 ? o.ownUnitSize : o.product.unitSize;

    // ── CASE 1: a stored per-unit price the bound refuses.
    if (o.pricePerUnit > 0) {
      const refusal = unitPriceRefusal(o.pricePerUnit, unit);
      if (refusal) {
        withheld.push({ id: o.id, merchant: o.merchant.slug, name: o.product.name, ppu: o.pricePerUnit, unit, size });
        if (!dry) {
          await prisma.offer.update({ where: { id: o.id }, data: { pricePerUnit: 0, pricePerUnitBani: null } });
          await recordRefusal({
            offerId: o.id,
            merchantId: o.merchantId,
            storeName: o.storeName,
            rejectedPriceBani: 0,
            acceptedPriceBani: o.priceBani ?? Math.round(o.price * 100),
            rawPriceText: o.rawPriceText,
            reason: `${refusal} (size ${size} ${unit}) — price kept, unit price withheld by backfill`,
          });
        }
        continue;
      }
    }

    // ── CASE 2: a zero we previously withheld that the CURRENT bound would accept. Restore it.
    if (o.pricePerUnit === 0 && size > 0) {
      const recomputed = (o.priceBani ?? Math.round(o.price * 100)) / 100 / size;
      if (recomputed > 0 && unitPriceRefusal(recomputed, unit) === null) {
        // Only restore where a refusal was actually recorded for this offer — otherwise this
        // would invent unit prices for rows that never had one, which is a different change
        // wearing the same name.
        const priorRefusal = await prisma.priceAnomaly.findFirst({
          where: { offerId: o.id, reason: { contains: "unit price withheld" } },
          select: { id: true },
        });
        if (!priorRefusal) continue;
        restored.push({ id: o.id, merchant: o.merchant.slug, name: o.product.name, ppu: recomputed, unit, size });
        if (!dry) {
          await prisma.offer.update({
            where: { id: o.id },
            data: { pricePerUnit: recomputed, pricePerUnitBani: perUnitBaniOrNull((o.priceBani ?? Math.round(o.price * 100)) / 100, size) },
          });
        }
      }
    }
  }

  console.log("═".repeat(100));
  console.log(`WITHHOLD IMPOSSIBLE UNIT PRICES${dry ? "  (DRY RUN — nothing written)" : ""}`);
  console.log("═".repeat(100));
  console.log(`  offers examined                 ${offers.length}`);
  console.log(`  unit prices WITHHELD            ${withheld.length}`);
  console.log(`  unit prices RESTORED            ${restored.length}   (the bound now accepts them)`);

  const byMerchant = new Map<string, number>();
  for (const w of withheld) byMerchant.set(w.merchant, (byMerchant.get(w.merchant) ?? 0) + 1);
  if (byMerchant.size > 0) {
    console.log(`\n  BY MERCHANT`);
    for (const [m, n] of [...byMerchant.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${m.padEnd(16)} ${String(n).padStart(4)}`);
  }

  console.log(`\n  WITHHELD, worst first — the PRICE on each of these is kept`);
  for (const w of [...withheld].sort((a, b) => b.ppu - a.ppu).slice(0, 30)) {
    console.log(`    ${w.ppu.toLocaleString("en", { maximumFractionDigits: 2 }).padStart(14)} /${w.unit}  for ${w.size} ${w.unit}  [${w.merchant}]  ${w.name.slice(0, 56)}`);
  }
  for (const r of restored.slice(0, 10)) {
    console.log(`    RESTORED ${r.ppu.toFixed(2)}/${r.unit}  ${r.name.slice(0, 60)}`);
  }

  emitJson({ dry, examined: offers.length, withheld: withheld.length, restored: restored.length, rows: withheld.slice(0, 200), pass: true });
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
