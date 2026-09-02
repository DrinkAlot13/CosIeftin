// A strikethrough is a claim about ONE offer's own history. It is not a way to render a range.
//
// The item page rendered `summary.highest` — the CROSS-STORE MAXIMUM — struck through beside
// the lowest price:
//
//     cel mai mic preț  12,00   ~~17,99~~
//
// 17,99 was another merchant's price for the same product. Struck through, that reads as
// "was 17,99, now 12,00": a discount nobody ever gave, on a product nobody ever discounted.
import { describe, it, expect } from "./run";
import { priceDisplayFor, priceRange } from "../src/lib/reference-price";

const offer = (over: Partial<Parameters<typeof priceDisplayFor>[0]> = {}) => ({
  priceBani: 1200,
  price: 12,
  referencePriceBani: null as number | null,
  referencePriceKind: null as string | null,
  ...over,
});

describe("strikethrough — only a genuine former price of the SAME offer", () => {
  it("strikes a real former price", () => {
    const d = priceDisplayFor(offer({ referencePriceBani: 1799, referencePriceKind: "STRIKETHROUGH" }));
    expect(d.kind).toBe("strike");
    if (d.kind === "strike") {
      expect(d.wasBani).toBe(1799);
      expect(d.savedBani).toBe(599);
    }
  });

  it("shows nothing struck when the offer has no reference at all", () => {
    // This is the case that produced the bug: no own reference, so the page reached for
    // another shop's price to fill the slot.
    expect(priceDisplayFor(offer()).kind).toBe("plain");
  });

  it("refuses a reference that is not ABOVE the current price", () => {
    // Equal, or lower, is not a discount — it is a price rise or a no-op.
    expect(priceDisplayFor(offer({ referencePriceBani: 1200, referencePriceKind: "STRIKETHROUGH" })).kind).toBe("plain");
    expect(priceDisplayFor(offer({ referencePriceBani: 999, referencePriceKind: "STRIKETHROUGH" })).kind).toBe("plain");
  });

  it("does NOT strike the Omnibus 30-day figure — it labels it", () => {
    // The EU Omnibus number is the LOWEST price in the past 30 days, printed because the law
    // requires it. Striking it claims the shopper saves that difference, when the figure is a
    // floor rather than a former price — and on a price INCREASE it would claim a discount
    // that runs the wrong way. CLAUDE.md is explicit about this; the brief allowed either,
    // and this is the deviation flagged in the morning report.
    const d = priceDisplayFor(offer({ referencePriceBani: 1799, referencePriceKind: "OMNIBUS_30D" }));
    expect(d.kind).toBe("omnibus");
  });

  it("shows LOYALTY and RRP plainly rather than as a discount", () => {
    expect(priceDisplayFor(offer({ referencePriceBani: 1799, referencePriceKind: "LOYALTY" })).kind).toBe("plain");
    expect(priceDisplayFor(offer({ referencePriceBani: 1799, referencePriceKind: "RRP" })).kind).toBe("plain");
  });
});

describe("a range is stated as a range", () => {
  it("labels the spread instead of implying a discount", () => {
    expect(priceRange(1200, 1799, 4)).toBe("între 12,00 și 17,99 lei în 4 magazine");
  });

  it("says nothing when there is only one shop", () => {
    expect(priceRange(1200, 1799, 1)).toBe(null);
  });

  it("says nothing when every shop charges the same", () => {
    expect(priceRange(1200, 1200, 3)).toBe(null);
  });
});
