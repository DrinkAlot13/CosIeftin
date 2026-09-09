// ── THE MERCHANT'S OWN PER-UNIT PRICE, read out of the payload it published.
//
// This is the project's only price figure that WE did not compute, which is what makes it an
// oracle: `audit:unit-oracle` compares our unit-price maths against it, and `audit:price-figures`
// compares our stored PACK price against it to catch the opposite defect — a per-unit figure
// stored as what the pack costs.
//
// It lives here rather than inside one audit because two scripts now need it, and a second copy
// is how `audit:rate-limit` came to recompute a budget it should have imported. `check:concepts`
// names this module as canonical.
//
// ── ONE READER PER MERCHANT, NOT ONE LOOSE REGEX.
//
// "The shape happens to match" is precisely how the wrong number gets read. Mega Image publishes
// `prices.unitPrice` on 100% of offers and it is THE PACK PRICE ECHOED BACK — verified on 40
// fixed packs where `unitPrice === price` with `unit: "piece"`, e.g. 12,89 for a 250 g cheese
// whose real per-kilo price is 51,56. A generic "find a field called unitPrice" reader would
// have adopted it and reported thousands of false disagreements. It is a genuine per-unit price
// there ONLY on the ~181 rows where `unitCode` is "kilogram", and until that is handled
// separately Mega Image has no reader at all.

export type MerchantUnitPrice = {
  /** the unit the merchant quotes in, lowercased: "kg" | "l" | "buc" | … */
  unit: string;
  /** the per-unit price, in the merchant's own lei */
  value: number;
  /** the merchant's OWN size string, where it publishes one — a second, independent check */
  amount?: string | null;
  /** true when the merchant says this item is sold by weight, so the unit price IS the price */
  weighted?: boolean;
};

/**
 * Pull a published per-unit price out of a merchant's source blob.
 *
 * Returns null when the merchant publishes none, when the payload cannot be parsed, or when
 * the figure is not a per-unit price at all. Null means "no independent figure available",
 * never "the figure is zero".
 */
export function readMerchantUnitPrice(merchantSlug: string, blob: string | null | undefined): MerchantUnitPrice | null {
  if (!blob) return null;
  let b: Record<string, unknown>;
  try { b = JSON.parse(blob) as Record<string, unknown>; } catch { return null; }

  // Kaufland: `formattedBasePrice` = "(=1 kg 17.22)" — unit first, DOT decimal, parenthesised.
  if (merchantSlug === "kaufland") {
    const raw = (b.formattedBasePrice ?? b.basePrice) as string | undefined;
    if (typeof raw !== "string") return null;
    const m = raw.match(/\(=\s*1\s*(kg|l|buc)\s+([\d.,]+)\)/i);
    if (!m) return null;
    const value = Number(m[2].replace(",", "."));
    return Number.isFinite(value) && value > 0 ? { unit: m[1].toLowerCase(), value } : null;
  }

  // ── SEZAMO publishes a RICHER oracle than Kaufland, on forty times as many offers.
  //
  //     prices.unitPrice  51.16      the per-unit price, computed by the shop
  //     unit              "kg"       the unit it is quoted in
  //     textualAmount     "250 g"    the shop's OWN size string — a second oracle, on our parse
  //     weightedItem      false      whether the item is sold by weight
  //
  // `weightedItem` is REPORTED rather than filtered here: a weighted item's per-unit price IS
  // its price, which makes it the wrong thing to compare against a pack-derived figure and the
  // right thing to compare against a stored pack price. The two callers need opposite
  // treatment, so the reader states the fact and lets each decide.
  if (merchantSlug === "sezamo") {
    const prices = b.prices as Record<string, unknown> | undefined;
    const value = prices && typeof prices.unitPrice === "number" ? prices.unitPrice : null;
    const unit = typeof b.unit === "string" ? b.unit.toLowerCase() : null;
    if (value === null || !unit || !(value > 0)) return null;
    return {
      unit,
      value,
      amount: typeof b.textualAmount === "string" ? b.textualAmount : null,
      weighted: b.weightedItem === true,
    };
  }

  return null;
}
