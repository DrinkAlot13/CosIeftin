// Shrinkflation: the pack gets smaller while the price does not fall, so the price PER UNIT
// rises without the shelf price appearing to move.
//
// This is an accusation-adjacent feature, so the bar is deliberately high:
//   • the pack must genuinely have changed size (not a parse wobble)
//   • the change must PERSIST across at least two consecutive observations
//   • the per-unit price must actually have risen by a material margin
//   • the unit family must be the same (a g → ml reparse is a parse bug, not shrinkflation)
// Anything short of that is not recorded. A false accusation is worse than a missed one.

import type { Bani } from "./price/parsePrice";
import { parseQuantity, type CanonicalUnit } from "./units/parseQuantity";

export type PackObservation = {
  /** the product name as the merchant wrote it AT THAT TIME */
  name: string;
  priceBani: Bani;
  observedAt: Date;
};

export type ShrinkflationFinding = {
  oldPackSize: number;
  newPackSize: number;
  unit: CanonicalUnit;
  oldPricePerUnitBani: Bani;
  newPricePerUnitBani: Bani;
  /** how much the per-unit price rose, in basis points */
  unitPriceRiseBp: number;
  /** how much the pack shrank, in basis points */
  packShrinkBp: number;
  oldPriceBani: Bani;
  newPriceBani: Bani;
  firstSeenSmallerAt: Date;
  confirmations: number;
  /** always true on creation — nothing is published without a human look */
  needsReview: boolean;
};

/** The pack must shrink by at least this much to count (below it is rounding/relabelling). */
const MIN_SHRINK_BP = 300; // 3%
/** The per-unit price must rise by at least this much. */
const MIN_UNIT_RISE_BP = 200; // 2%
/** How many observations at the smaller size before we believe it. */
const MIN_CONFIRMATIONS = 2;

/** Price per ONE canonical unit (per kg / L / piece), in bani. */
function perUnitBani(priceBani: Bani, quantity: number, unit: CanonicalUnit): number {
  const divisor = unit === "BUC" ? quantity : quantity / 1000;
  return divisor > 0 ? Math.round(priceBani / divisor) : priceBani;
}

/**
 * Detect shrinkflation from a product's observation history, oldest first.
 * @returns a finding, or null when the evidence does not clear every bar.
 */
export function detectShrinkflation(observations: PackObservation[]): ShrinkflationFinding | null {
  if (observations.length < 3) return null; // need a before, and two afters

  // resolve each observation's pack size from the name AS RECORDED THEN
  const parsed = observations
    .map((o) => ({ o, q: parseQuantity(o.name) }))
    .filter((x) => x.q != null) as { o: PackObservation; q: NonNullable<ReturnType<typeof parseQuantity>> }[];
  if (parsed.length < 3) return null;

  // A unit-family change (G -> ML) is a parse bug, not a smaller pack. Refuse to judge.
  const units = new Set(parsed.map((x) => x.q.unit));
  if (units.size > 1) return null;
  const unit = parsed[0].q.unit;

  const first = parsed[0];
  const last = parsed[parsed.length - 1];
  const oldPackSize = first.q.value;
  const newPackSize = last.q.value;
  if (!(oldPackSize > 0) || !(newPackSize > 0) || newPackSize >= oldPackSize) return null;

  const packShrinkBp = Math.round((1 - newPackSize / oldPackSize) * 10000);
  if (packShrinkBp < MIN_SHRINK_BP) return null;

  // The smaller size must PERSIST — one observation could be a bad parse or a typo on the
  // merchant's side. Count consecutive trailing observations at the new size.
  let confirmations = 0;
  for (let i = parsed.length - 1; i >= 0; i--) {
    if (Math.abs(parsed[i].q.value - newPackSize) < 1e-9) confirmations++;
    else break;
  }
  if (confirmations < MIN_CONFIRMATIONS) return null;

  const oldPerUnit = perUnitBani(first.o.priceBani, oldPackSize, unit);
  const newPerUnit = perUnitBani(last.o.priceBani, newPackSize, unit);
  if (!(oldPerUnit > 0)) return null;
  const unitPriceRiseBp = Math.round((newPerUnit / oldPerUnit - 1) * 10000);
  // The whole point: the per-unit price went UP. A smaller pack at a proportionally smaller
  // price is just a smaller pack.
  if (unitPriceRiseBp < MIN_UNIT_RISE_BP) return null;

  const firstSeenSmallerAt = parsed[parsed.length - confirmations].o.observedAt;

  return {
    oldPackSize,
    newPackSize,
    unit,
    oldPricePerUnitBani: oldPerUnit,
    newPricePerUnitBani: newPerUnit,
    unitPriceRiseBp,
    packShrinkBp,
    oldPriceBani: first.o.priceBani,
    newPriceBani: last.o.priceBani,
    firstSeenSmallerAt,
    confirmations,
    needsReview: true,
  };
}

/** Romanian copy. Factual: states the sizes, the dates and the per-unit change. */
export function shrinkflationNote(f: ShrinkflationFinding): string {
  const fmtSize = (v: number) => {
    if (f.unit === "BUC") return `${v} buc`;
    if (f.unit === "G") return v >= 1000 ? `${(v / 1000).toString().replace(".", ",")} kg` : `${v} g`;
    return v >= 1000 ? `${(v / 1000).toString().replace(".", ",")} l` : `${v} ml`;
  };
  const perUnitLabel = f.unit === "BUC" ? "bucată" : f.unit === "G" ? "kg" : "litru";
  const lei = (b: number) => `${(b / 100).toFixed(2).replace(".", ",")} lei`;
  return (
    `Ambalajul s-a micșorat de la ${fmtSize(f.oldPackSize)} la ${fmtSize(f.newPackSize)} ` +
    `(−${(f.packShrinkBp / 100).toFixed(1)}%), iar prețul pe ${perUnitLabel} a crescut de la ` +
    `${lei(f.oldPricePerUnitBani)} la ${lei(f.newPricePerUnitBani)} (+${(f.unitPriceRiseBp / 100).toFixed(1)}%). ` +
    `Prima observație la noul format: ${f.firstSeenSmallerAt.toLocaleDateString("ro-RO")}.`
  );
}
