// ── SCOPE: THE MERCHANT'S URL AS A SECOND OPINION ON PACK SIZE. READ-ONLY.
//
// A product URL is written by the merchant from its own catalogue, usually once, and it is not
// the string our size parser reads. So when the slug states a size and the NAME states a
// different one, two independent statements by the same merchant disagree — and one of them is
// driving a per-unit price on a page.
//
// FOUND BY ACCIDENT while diagnosing `probe:live-prices`:
//
//     name:  Macarons asortat Auchan, +/- 200 g        we file it as 0.2 kg
//     url:   /macarons-asortat-auchan-----1-kg/p       the merchant's own slug says 1 kg
//     shown: 139.99 lei  ->  699.95 lei/kg   or  139.99 lei/kg, depending which is right
//
// A five-fold error in the number this entire site exists to compare, and invisible to every
// internal check because the offer is perfectly consistent with the name it was parsed from.
//
// ── WHAT IT DOES NOT CLAIM. A disagreement does not say WHICH side is wrong. The slug can be
// stale — merchants change pack sizes and keep the URL for its search ranking — and the name can
// be wrong just as easily. This is a peer-relative check in the sense CLAUDE.md means: it flags
// disagreement, not guilt, and it prints both statements so a person decides.
//
// It also only fires where a size is stated in BOTH places. Silence on either side is not
// disagreement, the same rule the matcher applies to dosage.
//
//   npm run audit:slug-size

import { PrismaClient } from "@prisma/client";
import { parseQuantity } from "../src/lib/units/parseQuantity";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();
const MAX_AGE = 14 * 86_400_000;
/** Sizes within this of each other are the same pack described with different rounding. */
const TOLERANCE = 0.02;

/** The size a URL slug states, if it states one. `/macarons-...-1-kg/p` -> 1 kg. */
function sizeFromSlug(url: string): { unit: string; unitSize: number } | null {
  let path: string;
  try { path = new URL(url).pathname; } catch { return null; }
  // Slugs separate words with hyphens; parseQuantity wants spaces.
  const words = path.replace(/\/p\/?$/, "").split("/").pop() ?? "";
  // A HYPHEN BETWEEN TWO DIGITS IS A DECIMAL POINT, NOT A SEPARATOR. Auchan writes `0-275l`
  // for 0.275 l. Replacing every hyphen with a space read that as "0 275 l" and reported a
  // 275-LITRE cider — 1000x out, and this script then printed thousands of "disagreements"
  // that were entirely its own. The first run claimed 17.75%; almost all of it was this.
  const spaced = words.replace(/(\d)-(\d)/g, "$1.$2").replace(/-+/g, " ");
  const q = parseQuantity(spaced);
  if (!q || !q.value || q.value <= 0) return null;
  // `parseQuantity` answers in canonical G / ML / BUC; `Product.unit` is kg / l / buc. The
  // conversion lives here rather than in a second parser — CLAUDE.md allows exactly one size
  // parser, and `parseSize` in ingest-core is the other thin adapter over the same function.
  if (q.unit === "G") return { unit: "kg", unitSize: q.value / 1000 };
  if (q.unit === "ML") return { unit: "l", unitSize: q.value / 1000 };
  return { unit: "buc", unitSize: q.value };
}

async function main(): Promise<void> {
  const cutoff = new Date(Date.now() - MAX_AGE);
  const offers = await prisma.offer.findMany({
    where: {
      merchant: { active: true }, availability: "in stock", isStale: false, flagged: false,
      lastObservedAt: { gte: cutoff }, productUrl: { not: null },
    },
    select: {
      id: true, productUrl: true, storeName: true, price: true, priceBani: true,
      pricePerUnit: true, ownUnit: true, ownUnitSize: true,
      merchant: { select: { slug: true } },
      product: { select: { name: true, slug: true, unit: true, unitSize: true } },
    },
  });

  type Row = {
    offerId: number; merchant: string; name: string; url: string;
    nameSize: number; nameUnit: string; slugSize: number; slugUnit: string;
    ratio: number; pricePerUnit: number; productSlug: string;
  };
  const rows: Row[] = [];
  const byMerchant = new Map<string, { checked: number; disagree: number }>();

  for (const o of offers) {
    const slugSize = sizeFromSlug(o.productUrl as string);
    if (!slugSize) continue;
    // The size we ACTUALLY use for this offer's unit price.
    const unit = (o.ownUnitSize && o.ownUnitSize > 0 ? o.ownUnit : o.product.unit) ?? o.product.unit;
    const size = o.ownUnitSize && o.ownUnitSize > 0 ? o.ownUnitSize : o.product.unitSize;
    if (!size || size <= 0) continue;

    const e = byMerchant.get(o.merchant.slug) ?? { checked: 0, disagree: 0 };
    e.checked++;
    byMerchant.set(o.merchant.slug, e);

    // Compare only when the units agree; kg against buc is a different question.
    if (slugSize.unit !== unit.toLowerCase()) continue;
    const ratio = Math.max(size, slugSize.unitSize) / Math.min(size, slugSize.unitSize);
    if (ratio <= 1 + TOLERANCE) continue;

    e.disagree++;
    rows.push({
      offerId: o.id, merchant: o.merchant.slug, name: o.product.name, url: o.productUrl as string,
      nameSize: size, nameUnit: unit, slugSize: slugSize.unitSize, slugUnit: slugSize.unit,
      ratio: Number(ratio.toFixed(2)), pricePerUnit: o.pricePerUnit, productSlug: o.product.slug,
    });
  }

  const checked = [...byMerchant.values()].reduce((a, e) => a + e.checked, 0);
  console.log("═".repeat(100));
  console.log("PACK SIZE — the merchant's URL against the merchant's name");
  console.log("═".repeat(100));
  console.log(`  live offers with a product URL                    ${offers.length}`);
  console.log(`  ...whose slug states a size we can read           ${checked}`);
  console.log(`  ...where slug and name DISAGREE by >${TOLERANCE * 100}%          ${rows.length}` +
    `  (${((rows.length / Math.max(1, checked)) * 100).toFixed(2)}%)`);

  if (rows.length > 0) {
    console.log(`\n  BY MERCHANT`);
    for (const [m, e] of [...byMerchant.entries()].filter(([, e]) => e.disagree > 0).sort((a, b) => b[1].disagree - a[1].disagree)) {
      console.log(`    ${m.padEnd(16)} ${String(e.disagree).padStart(5)} of ${e.checked}`);
    }

    console.log(`\n${"─".repeat(100)}`);
    console.log(`WORST DISAGREEMENTS — sorted by how far apart the two statements are`);
    console.log("─".repeat(100));
    for (const r of [...rows].sort((a, b) => b.ratio - a.ratio).slice(0, 25)) {
      console.log(`  ${r.ratio}x  offer ${r.offerId} [${r.merchant}]  unit price now ${r.pricePerUnit.toFixed(2)}/${r.nameUnit}`);
      console.log(`     name says ${r.nameSize} ${r.nameUnit} — ${r.name.slice(0, 66)}`);
      console.log(`     url  says ${r.slugSize} ${r.slugUnit} — ${r.url.slice(0, 78)}`);
    }
    console.log(`\n  WHICH SIDE IS WRONG IS NOT DECIDED HERE. A slug outlives a pack change, and a`);
    console.log(`  name can be as wrong as a URL. Both statements are printed so a person judges.`);
  }

  emitJson({
    offersWithUrl: offers.length, slugStatesSize: checked, disagreements: rows.length,
    share: Number((rows.length / Math.max(1, checked)).toFixed(5)),
    byMerchant: [...byMerchant.entries()].map(([merchant, e]) => ({ merchant, ...e })),
    sample: [...rows].sort((a, b) => b.ratio - a.ratio).slice(0, 100),
    pass: true,
  });
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
