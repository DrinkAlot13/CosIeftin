// ── SCOPE: IS THE PER-UNIT PRICE A NUMBER A PERSON COULD BELIEVE? READ-ONLY.
//
// The per-unit price is what this site is FOR. Everything else — the catalog, the matcher, the
// basket optimiser — exists so that "which is cheaper per kilo" has an answer. So a per-unit
// price that is absurd is not a cosmetic defect: it is the product failing at its one job, in
// public, on a page a shopper is reading.
//
// ── WHY NOTHING CAUGHT THESE.
//
// `audit:price-truth` checks that `pricePerUnit` is INTERNALLY CONSISTENT — that price ÷ ppu
// yields a real size. It does, every time, including here:
//
//     Solutie contra aftelor bucale, 2,425 mg/21,34 mg/ml    9,500,000.00 lei/kg
//     Caffe latte Starbucks, fara zahar adaugat, 0.22 ml        59,954.55 lei/l
//
// Both are perfectly consistent. `0.22 ml` really is 0.00022 litres, and 13.19 lei divided by
// 0.00022 really is 59,954. The arithmetic is right and the SIZE is nonsense — the name states a
// concentration ("2,425 mg / 21,34 mg per ml") or a typo, and the size parser did what it was
// asked. Consistency checks cannot see this, by construction: both halves agree.
//
// This is a bound on the WORLD, not on our arithmetic. Nothing in a Romanian shop costs nine
// million lei a kilogram, and no rule inside the system knows that.
//
// ── THE BOUNDS ARE DELIBERATELY WIDE, and they are judgements.
//
// Saffron is genuinely thousands of lei per kilo; a 2 ml vial of vanilla essence is genuinely
// expensive per litre. The ceilings below are set where a number stops being surprising and
// starts being impossible, so a hit is worth a person's attention rather than a shrug. Set them
// tighter and this becomes another rule that fires constantly and detects nothing.
//
//   npm run audit:unit-price-sanity

import { PrismaClient } from "@prisma/client";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();
const MAX_AGE = 14 * 86_400_000;

/**
 * Per-unit prices beyond which the number cannot be describing a real purchase.
 *
 * These are JUDGEMENTS about Romanian retail, not measurements. Stated as numbers so they can
 * be argued with rather than left implicit in a threshold nobody can find.
 */
const CEILING: Record<string, number> = {
  // Saffron is ~10,000 lei/kg wholesale, so 50,000 leaves room for a boutique gram jar.
  kg: 50_000,
  // A 2 ml vial of essence at 15 lei is 7,500 lei/l. 100,000 is far past any of that.
  l: 100_000,
  // A single item's "per item" price is just its price; a bound here catches a broken packCount.
  buc: 100_000,
};
/**
 * Below this, the size is almost certainly a multiplier error rather than a cheap product.
 *
 * `buc` has NO floor, deliberately. A 350-piece bag of food bags at 3.16 lei really is 0.009 lei
 * each, and flagging it would be the check inventing a defect. The first run did exactly that.
 */
const FLOOR: Record<string, number> = { kg: 0.05, l: 0.05 };

async function main(): Promise<void> {
  const cutoff = new Date(Date.now() - MAX_AGE);
  const offers = await prisma.offer.findMany({
    where: {
      merchant: { active: true }, availability: "in stock", isStale: false, flagged: false,
      lastObservedAt: { gte: cutoff }, pricePerUnit: { gt: 0 },
    },
    select: {
      id: true, price: true, priceBani: true, pricePerUnit: true, storeName: true,
      ownUnit: true, ownUnitSize: true,
      merchant: { select: { slug: true } },
      product: { select: { name: true, slug: true, unit: true, unitSize: true, section: true } },
    },
  });

  type Hit = {
    offerId: number; merchant: string; section: string; name: string; slug: string;
    priceLei: number; pricePerUnit: number; unit: string; size: number; kind: "too-high" | "too-low";
  };
  const hits: Hit[] = [];
  const byMerchant = new Map<string, number>();
  const bySection = new Map<string, number>();
  let checked = 0;

  for (const o of offers) {
    const unit = ((o.ownUnitSize && o.ownUnitSize > 0 ? o.ownUnit : o.product.unit) ?? o.product.unit).toLowerCase();
    const ceiling = CEILING[unit];
    const floor = FLOOR[unit];
    if (ceiling === undefined) continue;
    checked++;
    const kind = o.pricePerUnit > ceiling ? "too-high" : o.pricePerUnit < floor ? "too-low" : null;
    if (!kind) continue;
    hits.push({
      offerId: o.id, merchant: o.merchant.slug, section: o.product.section,
      name: o.product.name, slug: o.product.slug,
      priceLei: (o.priceBani ?? Math.round(o.price * 100)) / 100,
      pricePerUnit: o.pricePerUnit, unit,
      size: o.ownUnitSize && o.ownUnitSize > 0 ? o.ownUnitSize : o.product.unitSize,
      kind,
    });
    byMerchant.set(o.merchant.slug, (byMerchant.get(o.merchant.slug) ?? 0) + 1);
    bySection.set(o.product.section, (bySection.get(o.product.section) ?? 0) + 1);
  }

  console.log("═".repeat(104));
  console.log("UNIT PRICE SANITY — is the number a person could believe?");
  console.log("═".repeat(104));
  console.log(`  live offers with a per-unit price                ${offers.length}`);
  console.log(`  ...in a unit with a stated bound                 ${checked}`);
  console.log(`  ...IMPOSSIBLE                                    ${hits.length}` +
    `  (${((hits.length / Math.max(1, checked)) * 100).toFixed(3)}%)`);
  console.log(`\n  bounds, per unit — these are JUDGEMENTS about Romanian retail, not measurements:`);
  for (const [u, c] of Object.entries(CEILING)) {
    const f = FLOOR[u];
    console.log(`    ${u.padEnd(4)} above ${c.toLocaleString("en")}/${u}` + (f === undefined ? "  (no floor — see FLOOR)" : ` or below ${f}/${u}`));
  }

  if (hits.length === 0) {
    console.log(`\n  NONE. Every live per-unit price falls inside the bounds.`);
    emitJson({ offers: offers.length, checked, impossible: 0, pass: true });
    return;
  }

  console.log(`\n  BY MERCHANT`);
  for (const [m, n] of [...byMerchant.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${m.padEnd(16)} ${String(n).padStart(5)}`);
  console.log(`\n  BY SECTION`);
  for (const [s, n] of [...bySection.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${s.padEnd(16)} ${String(n).padStart(5)}`);

  console.log(`\n${"─".repeat(104)}`);
  console.log(`EVERY ONE, worst first — each is a live page`);
  console.log("─".repeat(104));
  for (const h of [...hits].sort((a, b) => b.pricePerUnit - a.pricePerUnit).slice(0, 30)) {
    console.log(`  ${h.pricePerUnit.toLocaleString("en", { maximumFractionDigits: 2 }).padStart(14)} /${h.unit}   ${h.priceLei.toFixed(2)} lei for ${h.size} ${h.unit}   [${h.merchant}]`);
    console.log(`     ${h.name.slice(0, 84)}`);
    console.log(`     /p/${h.slug}`);
  }
  if (hits.length > 30) console.log(`\n  …and ${hits.length - 30} more.`);

  console.log(`\n  THE SIZE IS WRONG, NOT THE PRICE. In every case read so far the price matches the`);
  console.log(`  merchant's own, and the SIZE came from a name stating something that is not a`);
  console.log(`  pack size. Two shapes, both systematic:`);
  console.log(`\n    A DOSE READ AS A WEIGHT      "Spray oral cu nicotina, 1 mg"  -> 0.000001 kg`);
  console.log(`                                 "Colagen ... 12.500 mg"        -> 0.000013 kg`);
  console.log(`    A CAPACITY READ AS A VOLUME  "SACI MENAJ LDPE 320L"         -> 320 l of bin bag`);
  console.log(`                                 "FLOR BALSAM RUFE 1602L"       -> 1.602 l, not 1602`);
  console.log(`\n  A JUDGEMENT, AND IT IS MINE, NOT THE RULE'S: not every hit is a defect. Saffron at`);
  console.log(`  0.15 g really does work out near 123,000 lei/kg, and that number is correct and`);
  console.log(`  useless. The ones I verified as genuinely WRONG are the tortellini sold as "0,25 g"`);
  console.log(`  (it is 250 g), the yoghurt as "250 kg" (250 g), and every bin bag above.`);
  console.log(`\n  Withholding the unit price is the safe direction; withholding the OFFER would`);
  console.log(`  remove a price that is correct.`);

  emitJson({
    offers: offers.length, checked, impossible: hits.length,
    share: Number((hits.length / Math.max(1, checked)).toFixed(6)),
    byMerchant: [...byMerchant.entries()].map(([merchant, n]) => ({ merchant, n })),
    bySection: [...bySection.entries()].map(([section, n]) => ({ section, n })),
    hits: [...hits].sort((a, b) => b.pricePerUnit - a.pricePerUnit).slice(0, 200),
    pass: hits.length === 0,
  });
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
