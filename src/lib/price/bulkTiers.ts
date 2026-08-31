// Quantity-discount ladders.
//
// THE BUG THIS GUARDS: the previous tier pass attached one product's ladder to others. A
// product priced 11.65 lei carried a `qty:1` tier of 12.55, and the identical ladder
// [{1, 12.55}, {4, 8.40}] appeared on two products with different base prices. Nothing
// validated the result, so obviously-impossible ladders were stored and shown.
//
// A ladder is only believable if it behaves like a ladder: strictly cheaper as quantity
// rises, and every rung below the base price. Anything else is a parse error, not a bargain.

export type RawTier = { minQuantity: number; unitPriceBani: number };
export type ValidTier = RawTier & { discountBp: number };

export type TierValidation =
  | { ok: true; tiers: ValidTier[] }
  | { ok: false; reason: string; tiers: [] };

/** Plausibility bounds for a real bulk discount. */
const MAX_DISCOUNT_BP = 6000; // 60% off is already extraordinary
const MIN_DISCOUNT_BP = 100; // under 1% is noise, not a tier
const MAX_QUANTITY = 500;

/**
 * Validate a scraped ladder against its own base price.
 * @param basePriceBani the offer's single-unit price, WITH VAT
 */
export function validateTiers(basePriceBani: number, raw: RawTier[]): TierValidation {
  if (raw.length === 0) return { ok: true, tiers: [] }; // "checked, none offered" is valid
  if (!(basePriceBani > 0)) return { ok: false, reason: "no base price to validate against", tiers: [] };

  const sorted = [...raw].sort((a, b) => a.minQuantity - b.minQuantity);

  for (const t of sorted) {
    if (!Number.isInteger(t.minQuantity) || t.minQuantity < 2 || t.minQuantity > MAX_QUANTITY) {
      return { ok: false, reason: `implausible tier quantity ${t.minQuantity}`, tiers: [] };
    }
    if (!(t.unitPriceBani > 0)) {
      return { ok: false, reason: `tier ${t.minQuantity}+ has no price`, tiers: [] };
    }
    // EVERY rung must be below the base price. A "discount" at or above it is the signature
    // of a ladder borrowed from another product.
    if (t.unitPriceBani >= basePriceBani) {
      return {
        ok: false,
        reason: `tier ${t.minQuantity}+ at ${(t.unitPriceBani / 100).toFixed(2)} is not below the base price ${(basePriceBani / 100).toFixed(2)} — ladder likely belongs to a different product`,
        tiers: [],
      };
    }
  }

  // Strictly decreasing as quantity rises.
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].unitPriceBani >= sorted[i - 1].unitPriceBani) {
      return {
        ok: false,
        reason: `tier ${sorted[i].minQuantity}+ is not cheaper than tier ${sorted[i - 1].minQuantity}+`,
        tiers: [],
      };
    }
  }

  const tiers: ValidTier[] = [];
  for (const t of sorted) {
    const discountBp = Math.round((1 - t.unitPriceBani / basePriceBani) * 10000);
    if (discountBp < MIN_DISCOUNT_BP || discountBp > MAX_DISCOUNT_BP) {
      return { ok: false, reason: `tier ${t.minQuantity}+ implies a ${(discountBp / 100).toFixed(1)}% discount`, tiers: [] };
    }
    tiers.push({ ...t, discountBp });
  }
  return { ok: true, tiers };
}

/** Total cost in bani for `qty` units, using the best applicable rung. */
export function tieredTotalBani(basePriceBani: number, tiers: ValidTier[], qty: number): number {
  let unit = basePriceBani;
  for (const t of tiers) if (qty >= t.minQuantity && t.unitPriceBani < unit) unit = t.unitPriceBani;
  return unit * qty;
}

/**
 * The break-even framing a shopper can act on: "buy 6 instead of 3 and pay only X more for
 * twice the product". Returns null when no rung beats what they're already buying.
 */
export function nextTierAdvice(
  basePriceBani: number,
  tiers: ValidTier[],
  currentQty: number,
): { targetQty: number; extraCostBani: number; extraUnits: number; newUnitPriceBani: number } | null {
  const currentTotal = tieredTotalBani(basePriceBani, tiers, currentQty);
  let best: { targetQty: number; extraCostBani: number; extraUnits: number; newUnitPriceBani: number } | null = null;
  for (const t of tiers) {
    if (t.minQuantity <= currentQty) continue;
    const total = tieredTotalBani(basePriceBani, tiers, t.minQuantity);
    const extraCostBani = total - currentTotal;
    // only worth surfacing when the extra product costs less than it would at the base rate
    if (extraCostBani >= (t.minQuantity - currentQty) * basePriceBani) continue;
    if (!best || extraCostBani < best.extraCostBani) {
      best = { targetQty: t.minQuantity, extraCostBani, extraUnits: t.minQuantity - currentQty, newUnitPriceBani: t.unitPriceBani };
    }
  }
  return best;
}


/**
 * Cross-product smearing guard.
 *
 * A ladder read from a neighbouring product looks perfectly valid on its own — monotonic,
 * every rung below the base — so per-product validation cannot catch it. What gives it away
 * is the POPULATION: one identical ladder appearing on many products that have DIFFERENT
 * base prices. A real ladder is a function of its own price, so products at 8,22 / 8,94 /
 * 8,93 lei cannot all legitimately share the exact rung "3+ 6,99".
 *
 * Same price + same ladder is fine (a product line priced uniformly). Different prices +
 * identical ladder is not.
 *
 * @returns the ladder signatures that should be discarded
 */
export function findSmearedLadders(
  entries: { offerId: number; basePriceBani: number; tiers: { minQuantity: number; unitPriceBani: number }[] }[],
  opts: { minProducts?: number; minDistinctBases?: number } = {},
): { signatures: Set<string>; offerIds: Set<number> } {
  const minProducts = opts.minProducts ?? 5;
  const minDistinctBases = opts.minDistinctBases ?? 2;
  const bySig = new Map<string, { offerIds: number[]; bases: Set<number> }>();

  for (const e of entries) {
    if (e.tiers.length === 0) continue;
    const sig = [...e.tiers]
      .sort((a, b) => a.minQuantity - b.minQuantity)
      .map((t) => `${t.minQuantity}:${t.unitPriceBani}`)
      .join("|");
    const g = bySig.get(sig) ?? { offerIds: [], bases: new Set<number>() };
    g.offerIds.push(e.offerId);
    g.bases.add(e.basePriceBani);
    bySig.set(sig, g);
  }

  const signatures = new Set<string>();
  const offerIds = new Set<number>();
  for (const [sig, g] of bySig) {
    if (g.offerIds.length >= minProducts && g.bases.size >= minDistinctBases) {
      signatures.add(sig);
      for (const id of g.offerIds) offerIds.add(id);
    }
  }
  return { signatures, offerIds };
}
