// Romanian VAT.
//
// Rates from 1 August 2025 (Legea 141/2025): standard 21%, reduced 11% for basic food and a
// few other categories. The former 19% standard and the 9% / 5% reduced rates NO LONGER
// EXIST — anything in this codebase still assuming 19% is wrong.
//
// Verified empirically, not just asserted: DCNeu prints both the with-VAT and without-VAT
// figure on every card, and across 39 sampled non-food products the implied rate clustered
// at 20.97–21.05% (the spread is rounding noise from two-decimal prices). That is 21%.
//
// Stored as BASIS POINTS so the rate is an integer like every other money-adjacent value.

export const VAT_STANDARD_BP = 2100; // 21% — non-food, electronics, most goods
export const VAT_REDUCED_BP = 1100; // 11% — basic food, medicines, books, water

/** How a stored price relates to VAT. A price whose basis is unknown must not be stored. */
export type VatBasis = "WITH_VAT" | "WITHOUT_VAT";

/** Every rate currently legal in Romania. Used to snap a derived rate to a real one. */
const LEGAL_RATES_BP = [VAT_STANDARD_BP, VAT_REDUCED_BP] as const;

/** Tolerance when snapping: two-decimal prices make the implied rate wobble ~±0.1pp. */
const SNAP_TOLERANCE_BP = 25;

/**
 * Derive the VAT rate from a merchant that shows BOTH figures.
 *
 * This is the only trustworthy way to know a product's rate — DCNeu sells food (11%) and
 * non-food (21%) side by side, so a single assumed rate would be wrong for half the catalog.
 *
 * @returns the rate in basis points, or null when the two figures don't imply a legal rate.
 *          Null is the correct answer; guessing is not.
 */
export function deriveVatRateBp(withVatBani: number, withoutVatBani: number): number | null {
  if (!(withVatBani > 0) || !(withoutVatBani > 0)) return null;
  if (withVatBani < withoutVatBani) return null; // inverted — a parse error, not a rate
  const impliedBp = Math.round((withVatBani / withoutVatBani - 1) * 10000);
  for (const rate of LEGAL_RATES_BP) {
    if (Math.abs(impliedBp - rate) <= SNAP_TOLERANCE_BP) return rate;
  }
  return null; // implies no rate that currently exists in Romanian law
}

/** Add VAT to a net price. */
export function addVat(netBani: number, rateBp: number): number {
  return Math.round(netBani * (1 + rateBp / 10000));
}

/** Strip VAT from a gross price. */
export function removeVat(grossBani: number, rateBp: number): number {
  return Math.round(grossBani / (1 + rateBp / 10000));
}

/**
 * The price a consumer actually pays. Comparison and the optimizer use ONLY this — nobody
 * pays the "fără TVA" figure, and quoting it made DCNeu look ~21% cheaper than it is.
 * @returns null when the price cannot be expressed with VAT (unknown basis and no rate)
 */
export function consumerPriceBani(priceBani: number, basis: VatBasis, rateBp: number | null): number | null {
  if (basis === "WITH_VAT") return priceBani;
  if (rateBp == null) return null; // net price with no known rate is not a consumer price
  return addVat(priceBani, rateBp);
}

/** Human label for the UI. */
export function vatLabel(rateBp: number | null): string {
  if (rateBp == null) return "TVA necunoscut";
  return `TVA ${(rateBp / 100).toFixed(0)}%`;
}
