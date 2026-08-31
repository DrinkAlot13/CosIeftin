// VAT (Romania, post-Legea 141/2025) and quantity-discount ladders.
import { describe, it, expect } from "./run";
import { deriveVatRateBp, addVat, removeVat, consumerPriceBani, VAT_STANDARD_BP, VAT_REDUCED_BP } from "../src/lib/price/vat";
import { validateTiers, tieredTotalBani, nextTierAdvice, findSmearedLadders } from "../src/lib/price/bulkTiers";

describe("VAT — Romanian rates from 1 Aug 2025", () => {
  it("standard rate is 21%, not 19%", () => expect(VAT_STANDARD_BP).toBe(2100));
  it("reduced rate is 11%", () => expect(VAT_REDUCED_BP).toBe(1100));

  // The real DCNeu card that proved the rate: 13.63 with VAT, 11.26 without.
  it("derives 21% from a real DCNeu non-food card (13,63 / 11,26)", () =>
    expect(deriveVatRateBp(1363, 1126)).toBe(2100));
  it("derives 21% from a second real card (12,49 / 10,32)", () =>
    expect(deriveVatRateBp(1249, 1032)).toBe(2100));
  it("derives 11% for basic food", () => expect(deriveVatRateBp(1110, 1000)).toBe(1100));

  it("returns null rather than guessing when no legal rate fits", () =>
    expect(deriveVatRateBp(1190, 1000)).toBe(null)); // 19% no longer exists
  it("rejects an inverted pair (parse error, not a rate)", () => expect(deriveVatRateBp(1000, 1200)).toBe(null));
  it("rejects zero or missing figures", () => {
    expect(deriveVatRateBp(0, 1000)).toBe(null);
    expect(deriveVatRateBp(1000, 0)).toBe(null);
  });
  it("tolerates two-decimal rounding wobble", () => {
    // 20.97% and 21.05% both really are 21% priced to the ban
    expect(deriveVatRateBp(1210, 1000)).toBe(2100);
    expect(deriveVatRateBp(1209, 1000)).toBe(2100);
  });

  it("addVat / removeVat round-trip", () => expect(removeVat(addVat(1000, 2100), 2100)).toBe(1000));

  it("consumer price is the WITH_VAT figure — never the fără-TVA one", () => {
    expect(consumerPriceBani(1363, "WITH_VAT", 2100)).toBe(1363);
  });
  // Re-grossing a two-decimal net price cannot always reproduce the merchant's own gross
  // figure: 11,26 x 1.21 = 13,6246 -> 13,62, while the merchant printed 13,63. So the
  // WITH_VAT figure is preferred whenever the merchant states one, and re-grossing is a
  // fallback that can be a ban out.
  it("re-grossing a net price lands within one ban of the printed gross", () => {
    const regrossed = consumerPriceBani(1126, "WITHOUT_VAT", 2100)!;
    expect(Math.abs(regrossed - 1363) <= 1).toBeTruthy();
  });
  it("a net price with no known rate is NOT a consumer price", () =>
    expect(consumerPriceBani(1126, "WITHOUT_VAT", null)).toBe(null));
});

describe("bulk tiers — the corrupt-ladder guard", () => {
  it("accepts a well-formed ladder and computes discounts", () => {
    const r = validateTiers(778, [{ minQuantity: 3, unitPriceBani: 700 }, { minQuantity: 6, unitPriceBani: 661 }]);
    expect(r.ok).toBeTruthy();
    expect(r.tiers.length).toBe(2);
    expect(r.tiers[0].discountBp).toBe(1003); // ~10%
    expect(r.tiers[1].discountBp).toBe(1504); // ~15%
  });

  it("no tiers is valid — 'checked, none offered' is an answer", () =>
    expect(validateTiers(1000, []).ok).toBeTruthy());

  // THE real corruption: base 11.65 lei carrying a qty-1 tier of 12.55.
  it("REJECTS a rung at or above the base price (borrowed ladder)", () => {
    const r = validateTiers(1165, [{ minQuantity: 4, unitPriceBani: 1255 }]);
    expect(r.ok).toBeFalsy();
    expect(r.tiers.length).toBe(0);
  });
  it("REJECTS a non-decreasing ladder", () => {
    const r = validateTiers(1000, [{ minQuantity: 3, unitPriceBani: 800 }, { minQuantity: 6, unitPriceBani: 900 }]);
    expect(r.ok).toBeFalsy();
  });
  it("REJECTS an implausibly steep discount", () =>
    expect(validateTiers(1000, [{ minQuantity: 3, unitPriceBani: 10 }]).ok).toBeFalsy());
  it("REJECTS a tier quantity of 1 (that is the base price, not a tier)", () =>
    expect(validateTiers(1000, [{ minQuantity: 1, unitPriceBani: 900 }]).ok).toBeFalsy());
  it("accepts more than two rungs — ladders are not capped at two", () => {
    const r = validateTiers(1000, [
      { minQuantity: 3, unitPriceBani: 900 }, { minQuantity: 6, unitPriceBani: 850 },
      { minQuantity: 12, unitPriceBani: 800 }, { minQuantity: 24, unitPriceBani: 750 },
    ]);
    expect(r.ok).toBeTruthy();
    expect(r.tiers.length).toBe(4);
  });
});

describe("bulk tiers — shopper-facing maths", () => {
  const tiers = validateTiers(778, [{ minQuantity: 3, unitPriceBani: 700 }, { minQuantity: 6, unitPriceBani: 661 }]).tiers;

  it("uses the best applicable rung", () => {
    expect(tieredTotalBani(778, tiers, 1)).toBe(778);
    expect(tieredTotalBani(778, tiers, 3)).toBe(2100);
    expect(tieredTotalBani(778, tiers, 6)).toBe(3966);
  });

  // "buy 6 instead of 3 and pay only 18,66 lei more for twice the product"
  it("computes the break-even step to the next rung", () => {
    const a = nextTierAdvice(778, tiers, 3)!;
    expect(a.targetQty).toBe(6);
    expect(a.extraUnits).toBe(3);
    expect(a.extraCostBani).toBe(1866);
    // the extra 3 units cost less than 3 x the base price — that is the whole point
    expect(a.extraCostBani < 3 * 778).toBeTruthy();
  });
  it("returns null when already at the best rung", () => expect(nextTierAdvice(778, tiers, 6)).toBe(null));
  it("returns null when there are no tiers", () => expect(nextTierAdvice(778, [], 1)).toBe(null));
});

describe("bulk tiers — cross-product smearing guard", () => {
  it("flags one ladder shared across products with DIFFERENT base prices", () => {
    // the real case: "3+ 6,99" on products priced 8,22 / 8,94 / 8,93 …
    const entries = [822, 894, 893, 850, 870, 880].map((base, i) => ({
      offerId: i + 1, basePriceBani: base, tiers: [{ minQuantity: 3, unitPriceBani: 699 }],
    }));
    const r = findSmearedLadders(entries);
    expect(r.offerIds.size).toBe(6);
  });

  it("does NOT flag a uniformly-priced product line sharing one ladder", () => {
    // same price + same ladder is legitimate — a line priced identically
    const entries = [1165, 1165, 1165, 1165, 1165, 1165].map((base, i) => ({
      offerId: i + 1, basePriceBani: base, tiers: [{ minQuantity: 3, unitPriceBani: 990 }],
    }));
    expect(findSmearedLadders(entries).offerIds.size).toBe(0);
  });

  it("does not flag a small group", () => {
    const entries = [800, 900].map((base, i) => ({ offerId: i + 1, basePriceBani: base, tiers: [{ minQuantity: 3, unitPriceBani: 600 }] }));
    expect(findSmearedLadders(entries).offerIds.size).toBe(0);
  });

  it("ignores products with no tiers", () =>
    expect(findSmearedLadders([{ offerId: 1, basePriceBani: 1000, tiers: [] }]).offerIds.size).toBe(0));
});
