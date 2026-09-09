// WHAT A PER-UNIT PRICE CAN POSSIBLY BE, defined once.
//
// ── THE DEFECT THIS EXISTS FOR, and why no internal check could see it.
//
// 28 live offers showed per-unit prices no one could believe, the worst being a nicotine spray
// at **86,500,000 lei/kg**. Every one of them was INTERNALLY CONSISTENT:
//
//     86.50 lei / 0.000001 kg  =  86,500,000 lei/kg      "Spray oral cu nicotina, 1 mg"
//     19.00 lei / 0.000002 kg  =   9,500,000 lei/kg      "Solutie ... 2,425 mg/21,34 mg/ml"
//     12.19 lei / 1200 l       =        0.01 lei/l       "Fino Saci Pt Gunoi Ld120L*10 Buc"
//
// `audit:price-truth` verifies that price ÷ pricePerUnit yields a real size, and it does, every
// time. The arithmetic is right; the SIZE is nonsense. A DOSE was read as a pack weight, or a
// bin bag's CAPACITY as the volume of its contents. A consistency check cannot see this by
// construction, because both halves agree.
//
// This is a bound on the WORLD rather than on our arithmetic, and nothing inside the system
// knew that nothing in a Romanian shop costs nine million lei a kilogram.
//
// ── WHY IT LIVES HERE AND NOT IN THE AUDIT.
//
// The audit that found these had its own copy of the numbers. A rule that only an audit knows
// is a rule the WRITE PATH does not apply, so the next scrape recreates every one of them and
// the audit reports them again forever. CLAUDE.md: "One vocabulary per column, defined in
// TypeScript." The write path, the audit and the `audit:db` invariant all import THIS.
//
// ── THE NUMBERS ARE JUDGEMENTS, and they are deliberately loose.
//
// Saffron genuinely runs to ~123,000 lei/kg in a 0.15 g jar, and that number is correct and
// useless. These bounds sit where a figure stops being surprising and becomes impossible, so a
// hit is worth a person's attention. Tighten them and this becomes another rule that fires
// constantly and detects nothing — the failure `audit:discriminator` already demonstrated.

/** Canonical units a price can be quoted per, as `Product.unit` / `Offer.ownUnit` spell them. */
export type PriceUnit = "kg" | "l" | "buc";

/**
 * Above this, the size must be wrong.
 *
 * `kg` is the tightest because dosage errors land here: a name stating "500 mg" parsed as a pack
 * weight produces a per-kilogram figure in the millions.
 */
export const UNIT_PRICE_CEILING: Readonly<Record<PriceUnit, number>> = {
  // Saffron wholesale is ~10,000 lei/kg; 50,000 leaves room for a boutique gram jar.
  kg: 50_000,
  // A 2 ml vial of essence at 15 lei is 7,500 lei/l. 100,000 is far past any of it.
  l: 100_000,
  // "Per piece" for a single item is just its price; this catches a broken packCount.
  buc: 100_000,
};

/**
 * Below this, the size is a multiplier error rather than a cheap product.
 *
 * `buc` has NO floor, deliberately: a 350-piece box of food bags at 3.16 lei really is 0.009 lei
 * each. Flagging it would be the rule inventing a defect, which the first version did.
 */
export const UNIT_PRICE_FLOOR: Readonly<Partial<Record<PriceUnit, number>>> = {
  kg: 0.05,
  l: 0.05,
};

export function isPriceUnit(unit: string | null | undefined): unit is PriceUnit {
  const u = (unit ?? "").toLowerCase();
  return u === "kg" || u === "l" || u === "buc";
}

/** Why a per-unit price was refused, for the refusal record. Null when it is fine. */
export function unitPriceRefusal(perUnitLei: number, unit: string | null | undefined): string | null {
  if (!Number.isFinite(perUnitLei) || perUnitLei <= 0) return null; // absent, not implausible
  const u = (unit ?? "").toLowerCase();
  if (!isPriceUnit(u)) return null; // no bound stated for this unit: say nothing rather than guess
  const ceiling = UNIT_PRICE_CEILING[u];
  if (perUnitLei > ceiling) return `unit-price ${perUnitLei.toFixed(2)}/${u} above the ${ceiling}/${u} ceiling — the SIZE is wrong, not the price`;
  const floor = UNIT_PRICE_FLOOR[u];
  if (floor !== undefined && perUnitLei < floor) return `unit-price ${perUnitLei}/${u} below the ${floor}/${u} floor — the SIZE is wrong, not the price`;
  return null;
}

/** True when this per-unit price could describe a real purchase. */
export function unitPriceIsPlausible(perUnitLei: number, unit: string | null | undefined): boolean {
  return unitPriceRefusal(perUnitLei, unit) === null;
}
