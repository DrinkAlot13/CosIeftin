// PRODUCTS SOLD BY WEIGHT: three facts, kept apart.
//
// ── THE DEFECT. Mega Image offer 480057 read 25,19 from us and 35,99 from the shop's own page,
// and both numbers were right. Their payload carries both:
//
//     price.value                    25.19     what a typical piece costs at the till
//     price.unitPrice                35.99     the price PER KILOGRAM
//     price.unit                     "kg"
//     price.supplementaryPriceLabel1 "+/- 25.19 LEI"
//     price.supplementaryPriceLabel2 "+/- 0.700 Kg"
//
//     35.99 lei/kg  x  0.700 kg  =  25.193  ->  25.19
//
// We stored the piece price against a `1 buc` product with no unit price. The shopper saw
// "25,19 lei" with nothing saying it is roughly 700 g, and the product could not enter the
// per-unit comparison the whole site exists to perform.
//
// ── WHY THE MERCHANT'S OWN unitPrice IS THE ONE TO KEEP.
//
// It is computed by the SHOP from the real pack, with no involvement from us — the same class of
// evidence as Kaufland's `formattedBasePrice`, which `audit:unit-oracle` already treats as an
// external oracle. Deriving a per-kilo figure from price ÷ approximate weight would re-introduce
// exactly the guess this module exists to remove, and it would be wrong by however much the
// piece differs from "typical".
//
// ── AND THE "+/-" MATTERS. `supplementaryPriceLabel1` says APPROXIMATELY 25,19 lei, because the
// shopper pays for the piece they are handed. A price presented without that caveat is a promise
// the shop has not made.

/** The three facts, or null when this is an ordinary fixed-pack product. */
export type VariableWeight = {
  /** The merchant's own price per canonical unit, in the unit below. */
  quotedUnitPrice: number;
  /** "kg" | "l" | "buc", as the merchant states it. */
  unit: string;
  /** The approximate pack size the merchant advertises, in the same unit. */
  approxSize: number;
  /** The approximate till price for a typical piece — what `price.value` already holds. */
  approxPrice: number;
};

/** "+/- 0.700 Kg" -> 0.7 ; "+/- 250 g" -> 0.25 ; returns null when the label is not a weight. */
export function parseApproxSize(label: string | null | undefined): { size: number; unit: string } | null {
  if (!label) return null;
  const m = /\+\/-\s*([\d.,]+)\s*(kg|g|l|ml)\b/i.exec(label);
  if (!m) return null;
  const value = Number(m[1].replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = m[2].toLowerCase();
  if (unit === "kg") return { size: value, unit: "kg" };
  if (unit === "g") return { size: value / 1000, unit: "kg" };
  if (unit === "l") return { size: value, unit: "l" };
  return { size: value / 1000, unit: "l" };
}

/**
 * Read the variable-weight shape out of a merchant's own price object.
 *
 * Deliberately STRICT: every one of the three facts must be present and they must agree with
 * each other to within a few percent. A payload that half-matches is not a variable-weight
 * product with a missing field — it is a shape we do not understand, and guessing at it is how a
 * per-kilo price gets written as a pack price.
 */
export function readVariableWeight(price: unknown): VariableWeight | null {
  if (!price || typeof price !== "object") return null;
  const p = price as Record<string, unknown>;

  const quoted = typeof p.unitPrice === "number" ? p.unitPrice : null;
  const value = typeof p.value === "number" ? p.value : null;
  const unit = typeof p.unit === "string" ? p.unit.toLowerCase() : null;
  const approx = parseApproxSize(typeof p.supplementaryPriceLabel2 === "string" ? p.supplementaryPriceLabel2 : null);
  if (quoted === null || value === null || !unit || !approx) return null;
  if (!(quoted > 0) || !(value > 0)) return null;
  // The merchant must be quoting in the unit its own weight label uses.
  if (unit !== approx.unit) return null;

  // THE AGREEMENT CHECK. unitPrice x weight must reproduce the till price. When it does not,
  // the payload means something other than what this function assumes, and returning null is
  // the honest answer. 3% absorbs the merchant's own rounding.
  const derived = quoted * approx.size;
  if (Math.abs(derived - value) > Math.max(0.02, value * 0.03)) return null;

  return { quotedUnitPrice: quoted, unit, approxSize: approx.size, approxPrice: value };
}
