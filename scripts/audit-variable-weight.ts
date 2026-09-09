// ── SCOPE: VARIABLE-WEIGHT PRODUCTS SHOWN AS FIXED UNITS. READ-ONLY.
//
// FOUND BY `probe:live-prices`, which is the point of having an external oracle. Mega Image
// offer 480057 read 25.19 from us and 35.99 from the shop's own page. Neither number was wrong:
// the merchant's stored record carries BOTH, and they mean different things.
//
//     PriceLabel1: "+/- 25.19 LEI"      PriceLabel2: "+/- 0.700 Kg"      Price: 35.99
//
//     35.99 lei/kg  x  0.700 kg  =  25.193  ->  25.19
//
// So 35.99 is the price PER KILOGRAM and 25.19 is the approximate price of a typical piece. We
// stored the piece price against a product whose size is `1 buc`, with `pricePerUnit` at 0.
//
// ── WHY THAT MATTERS MORE THAN A WRONG NUMBER WOULD.
//
//   • The shopper sees "25,19 lei" with nothing saying it is roughly 700 g and that the real
//     price depends on the piece they are handed at the counter.
//   • It cannot be compared. Another shop's pork belly is quoted per kilogram, and this project
//     exists to compare per-unit prices. A `buc` with no weight is outside that entirely.
//   • It is invisible to every internal check, and correctly so: 25.19 re-derives perfectly from
//     its own `rawPriceText`, which is what `audit:price-truth` measures. The offer is
//     internally consistent and describes the wrong quantity.
//
// The tell is in the merchant's own payload — the "+/-" that says "approximately". This counts
// how many live offers carry it.
//
// IT REPORTS AND RANKS. It changes nothing: deciding what a variable-weight offer should show
// is a product decision, and the options (quote per kg, show the approximate weight, or withhold
// from comparison) are not equivalent.
//
//   npm run audit:variable-weight

import { PrismaClient } from "@prisma/client";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();
const MAX_AGE = 14 * 86_400_000;

/** The merchant's own "approximately" marker, as it appears in the stored payload. */
const APPROX = /\+\/-\s*([\d.,]+)\s*(kg|g|lei)/gi;

/**
 * EVERY WAY A MERCHANT MIGHT SAY "PRICED BY WEIGHT", not just Mega Image's.
 *
 * The first version of this audit matched only "+/-", which is Mega Image's and Auchan's
 * spelling, and reported those two as though they were the whole population. A detector shaped
 * around one merchant's payload cannot tell "nobody else does this" from "I only looked in one
 * place" — the same mistake the Freshful brand-omission survey made before it was widened.
 *
 * So the sweep looks for the SHAPE: a per-unit price quoted by the merchant, a unit-price
 * label, or a weight-priced marker, in any payload.
 */
const WEIGHT_PRICING_SIGNALS: { name: string; re: RegExp }[] = [
  { name: "+/- approximate", re: /\+\/-\s*[\d.,]+\s*(kg|g)\b/i },
  { name: "unitPrice field", re: /"unitPrice"\s*:\s*[\d.]+/i },
  { name: "lei/kg label", re: /lei\s*\/\s*kg/i },
  { name: "price per kg text", re: /pret[^"]{0,12}\/\s*kg/i },
  { name: "formattedBasePrice", re: /formattedBasePrice/i },
  { name: "unitCode kilogram", re: /"unitCode"\s*:\s*"kilogram"/i },
];

async function main(): Promise<void> {
  const cutoff = new Date(Date.now() - MAX_AGE);
  const offers = await prisma.offer.findMany({
    where: {
      merchant: { active: true }, availability: "in stock", isStale: false, flagged: false,
      lastObservedAt: { gte: cutoff }, rawSourceBlob: { not: null },
    },
    select: {
      id: true, price: true, priceBani: true, rawSourceBlob: true, storeName: true,
      ownUnit: true, ownUnitSize: true, pricePerUnit: true,
      merchant: { select: { slug: true } },
      product: { select: { name: true, slug: true, unit: true, unitSize: true } },
    },
  });

  type Hit = {
    offerId: number; merchant: string; product: string; slug: string;
    ourBani: number; approxWeightKg: number | null; perKg: number | null;
    catalogUnit: string; catalogSize: number; pricePerUnit: number;
  };
  const hits: Hit[] = [];
  const byMerchant = new Map<string, number>();

  for (const o of offers) {
    const blob = o.rawSourceBlob ?? "";
    APPROX.lastIndex = 0;
    const marks = [...blob.matchAll(APPROX)];
    if (marks.length === 0) continue;

    // The weight the merchant calls approximate, and their per-kg price if the payload has one.
    let weightKg: number | null = null;
    for (const m of marks) {
      const value = Number(m[1].replace(",", "."));
      const unit = m[2].toLowerCase();
      if (unit === "kg" && Number.isFinite(value)) weightKg = value;
      else if (unit === "g" && Number.isFinite(value)) weightKg = value / 1000;
    }
    const perKgMatch = blob.match(/"Price"\s*:\s*([\d.]+)/);
    const perKg = perKgMatch ? Number(perKgMatch[1]) : null;

    hits.push({
      offerId: o.id, merchant: o.merchant.slug, product: o.product.name, slug: o.product.slug,
      ourBani: o.priceBani ?? Math.round(o.price * 100),
      approxWeightKg: weightKg, perKg,
      catalogUnit: o.product.unit, catalogSize: o.product.unitSize,
      pricePerUnit: o.pricePerUnit,
    });
    byMerchant.set(o.merchant.slug, (byMerchant.get(o.merchant.slug) ?? 0) + 1);
  }

  console.log("═".repeat(100));
  console.log("VARIABLE-WEIGHT OFFERS — priced by the kilo, shown as a piece");
  console.log("═".repeat(100));
  console.log(`  live offers carrying a source payload            ${offers.length}`);
  console.log(`  ...whose payload says "+/-" (approximately)      ${hits.length}` +
    `  (${((hits.length / Math.max(1, offers.length)) * 100).toFixed(2)}%)`);

  // ── THE SWEEP: does any OTHER merchant price by weight in a different vocabulary?
  const signalHits = new Map<string, Map<string, number>>();
  for (const o of offers) {
    const blob = o.rawSourceBlob ?? "";
    for (const sig of WEIGHT_PRICING_SIGNALS) {
      if (!sig.re.test(blob)) continue;
      let m = signalHits.get(sig.name);
      if (!m) signalHits.set(sig.name, (m = new Map()));
      m.set(o.merchant.slug, (m.get(o.merchant.slug) ?? 0) + 1);
    }
  }
  console.log(`
  WEIGHT-PRICING SIGNALS, ACROSS EVERY MERCHANT`);
  console.log(`  (the "+/-" count above is ONE merchant's spelling; these are the others)`);
  for (const sig of WEIGHT_PRICING_SIGNALS) {
    const m = signalHits.get(sig.name);
    if (!m || m.size === 0) { console.log(`    ${sig.name.padEnd(22)} —`); continue; }
    const parts = [...m.entries()].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`);
    console.log(`    ${sig.name.padEnd(22)} ${parts.join("  ")}`);
  }

  if (hits.length === 0) {
    console.log(`\n  NONE TODAY. The marker is merchant-specific, so this measures Mega Image's`);
    console.log(`  payload shape and would miss the same problem written differently elsewhere.`);
    emitJson({ offersWithBlob: offers.length, variableWeight: 0, pass: true });
    return;
  }

  console.log(`\n  BY MERCHANT`);
  for (const [m, n] of [...byMerchant.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${m.padEnd(16)} ${String(n).padStart(5)}`);
  }

  // The ones that are ALSO uncomparable: no unit price at all.
  const noUnitPrice = hits.filter((h) => !h.pricePerUnit);
  const asBuc = hits.filter((h) => h.catalogUnit === "buc");
  console.log(`\n  ...of those, with NO unit price at all           ${noUnitPrice.length}`);
  console.log(`  ...filed under "buc" rather than a weight        ${asBuc.length}`);
  console.log(`\n  A "buc" with no weight cannot enter a per-unit comparison, which is what this`);
  console.log(`  site is for. That is the cost, and it is larger than a wrong number would be.`);

  console.log(`\n${"─".repeat(100)}`);
  console.log(`${Math.min(20, hits.length)} TO READ — our price, and what the merchant says it is per kilo`);
  console.log("─".repeat(100));
  const lei = (b: number) => (b / 100).toFixed(2);
  for (const h of hits.slice(0, 20)) {
    const derived = h.perKg !== null && h.approxWeightKg !== null
      ? `  ${h.perKg} lei/kg x ${h.approxWeightKg} kg = ${(h.perKg * h.approxWeightKg).toFixed(2)}`
      : "";
    console.log(`  offer ${h.offerId} [${h.merchant}]  we show ${lei(h.ourBani)} as ${h.catalogSize} ${h.catalogUnit}${derived}`);
    console.log(`     ${h.product.slice(0, 78)}`);
  }

  emitJson({
    offersWithBlob: offers.length,
    variableWeight: hits.length,
    share: Number((hits.length / Math.max(1, offers.length)).toFixed(5)),
    noUnitPrice: noUnitPrice.length,
    filedAsBuc: asBuc.length,
    byMerchant: [...byMerchant.entries()].map(([merchant, n]) => ({ merchant, n })),
    sample: hits.slice(0, 100),
    pass: true,
  });
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
