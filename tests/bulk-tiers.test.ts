// Quantity discounts: 5,024 rows across 3,938 offers, in the database for several sessions
// and never rendered anywhere.
//
// DCNeu is a discounter. The ladder IS the offer, and a page showing only the single-unit
// price shows the least attractive number on the card.
//
// The two rules that matter here are both about not lying:
//   • a ladder hanging off a WITHHELD base price is a made-up number wearing a percentage
//   • a "buy more and save" prompt that costs MORE IN TOTAL is an upsell, not a saving
import { describe, it, expect } from "./run";
import { visibleTiers, unitPriceAtQty, nextRungHint, discountBpOf } from "../src/lib/bulk-tiers";

const offer = (over: Partial<Parameters<typeof visibleTiers>[0]> = {}) => ({
  priceBani: 1563,
  price: 15.63,
  flagged: false,
  isStale: false,
  availability: "in stock",
  // The real DENIM AFTER SHAVE 100ML BLACK ladder.
  tiers: [
    { minQuantity: 2, unitPriceBani: 1329, discountBp: 1500 },
    { minQuantity: 4, unitPriceBani: 1250, discountBp: 2000 },
  ],
  ...over,
});

describe("bulk tiers — what may be shown", () => {
  it("reads a real DCNeu ladder", () => {
    const l = visibleTiers(offer())!;
    expect(l.baseBani).toBe(1563);
    expect(l.rungs.length).toBe(2);
    expect(l.bestUnitBani).toBe(1250);
    expect(l.bestFromQty).toBe(4);
  });

  it("recomputes the discount instead of trusting the stored basis points", () => {
    // A stored discount and a re-derived one disagreeing is a whole class of bug in this
    // project. The table renders the derived value.
    // 313 / 1563 = 20.0256%, which rounds to 2003 bp. The stored value says 2000.
    expect(discountBpOf(1563, 1250)).toBe(2003);
  });

  it("REFUSES a ladder on a flagged offer", () => {
    // The base price is withheld from display, so a percentage off it is fiction.
    expect(visibleTiers(offer({ flagged: true }))).toBe(null);
  });

  it("REFUSES a ladder on a stale or out-of-stock offer", () => {
    expect(visibleTiers(offer({ isStale: true }))).toBe(null);
    expect(visibleTiers(offer({ availability: "out of stock" }))).toBe(null);
  });

  it("REFUSES a ladder that does not get cheaper as quantity rises", () => {
    // Monotonic or mis-parsed. Showing it would advertise a discount that is not there.
    const bad = offer({
      tiers: [
        { minQuantity: 2, unitPriceBani: 1200, discountBp: null },
        { minQuantity: 4, unitPriceBani: 1400, discountBp: null },
      ],
    });
    expect(visibleTiers(bad)).toBe(null);
  });

  it("REFUSES a rung that is not below the base", () => {
    const bad = offer({ tiers: [{ minQuantity: 2, unitPriceBani: 1563, discountBp: null }] });
    expect(visibleTiers(bad)).toBe(null);
  });
});

describe("bulk tiers — what a shopper pays", () => {
  const l = visibleTiers(offer())!;

  it("charges the base below the first rung", () => {
    expect(unitPriceAtQty(l, 1563, 1)).toBe(1563);
  });

  it("charges the rung price at and above its threshold", () => {
    expect(unitPriceAtQty(l, 1563, 2)).toBe(1329);
    expect(unitPriceAtQty(l, 1563, 3)).toBe(1329);
    expect(unitPriceAtQty(l, 1563, 4)).toBe(1250);
    expect(unitPriceAtQty(l, 1563, 99)).toBe(1250);
  });
});

describe("bulk tiers — the near-miss prompt only when it really saves", () => {
  const l = visibleTiers(offer())!;

  it("stays silent when reaching the rung costs more in total, even at qty 1", () => {
    // 1 × 15,63 = 15,63 against 2 × 13,29 = 26,58 — MORE in total, so no prompt.
    // A per-unit saving is not a saving if the shopper leaves with a bigger bill.
    expect(nextRungHint(l, 1563, 1)).toBe(null);
  });

  it("does not prompt when reaching the rung costs more overall", () => {
    // 3 × 13,29 = 39,87 against 4 × 12,50 = 50,00 — more. Silence is correct.
    expect(nextRungHint(l, 1563, 3)).toBe(null);
  });

  it("DOES prompt when the arithmetic genuinely favours the shopper", () => {
    // A steep rung: 1 at 10,00 vs 2 at 4,00 = 8,00 total. Adding one costs less overall.
    const steep = visibleTiers(offer({
      priceBani: 1000, price: 10,
      tiers: [{ minQuantity: 2, unitPriceBani: 400, discountBp: 6000 }],
    }))!;
    const h = nextRungHint(steep, 1000, 1)!;
    expect(h.addUnits).toBe(1);
    expect(h.atQty).toBe(2);
    expect(h.newUnitBani).toBe(400);
    expect(h.savesBani).toBe(200);
  });

  it("does not look further than two rungs ahead", () => {
    const far = visibleTiers(offer({
      priceBani: 1000, price: 10,
      tiers: [{ minQuantity: 12, unitPriceBani: 100, discountBp: 9000 }],
    }))!;
    expect(nextRungHint(far, 1000, 1)).toBe(null);
  });
});
