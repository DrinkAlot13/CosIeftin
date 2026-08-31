// EU Omnibus reference prices. Romanian retailers are legally required to print the
// lowest price of the last 30 days next to a promo. We must never quote it as the current
// price — but it is the retailer's own sworn statement about recent pricing, so we capture
// it. That is what lets us tell a real promo from a fake one later.
import { describe, it, expect } from "./run";
import { parsePriceDetailed, parsePrice } from "../src/lib/price/parsePrice";

describe("reference price — Omnibus wording variants", () => {
  it('classic "preț minim ultimele 30 de zile"', () => {
    const r = parsePriceDetailed("preț minim ultimele 30 de zile: 7,99 LEI preț fără card 11,99 LEI");
    expect(r.priceBani).toBe(1199);
    expect(r.referencePriceBani).toBe(799);
    expect(r.referencePriceKind).toBe("OMNIBUS_30D");
  });
  it('cedilla spelling "preţ minim"', () => {
    const r = parsePriceDetailed("preţ minim ultimele 30 de zile: 7,99 lei · acum 11,99 lei");
    expect(r.referencePriceBani).toBe(799);
    expect(r.referencePriceKind).toBe("OMNIBUS_30D");
  });
  it('"cel mai mic preț" phrasing', () => {
    const r = parsePriceDetailed("14,99 lei — cel mai mic preț din ultimele 30 de zile 12,49 lei");
    expect(r.referencePriceBani).toBe(1249);
    expect(r.referencePriceKind).toBe("OMNIBUS_30D");
  });
  it('"preț anterior" phrasing', () => {
    const r = parsePriceDetailed("9,99 lei preț anterior 13,49 lei");
    expect(r.referencePriceBani).toBe(1349);
    expect(r.referencePriceKind).toBe("OMNIBUS_30D");
  });
  it("the reference NEVER becomes the current price", () => {
    expect(parsePrice("preț minim ultimele 30 de zile: 7,99 LEI preț fără card 11,99 LEI")).toBe(1199);
  });
  it("a reference-only block still yields no current price", () => {
    const r = parsePriceDetailed("preț minim ultimele 30 de zile: 7,99 LEI");
    expect(r.priceBani).toBe(null);
  });
});

describe("reference price — strikethrough pages", () => {
  it("<del> was-price", () => {
    const r = parsePriceDetailed("<del>19,99 lei</del> 14,99 lei");
    expect(r.priceBani).toBe(1499);
    expect(r.referencePriceBani).toBe(1999);
    expect(r.referencePriceKind).toBe("STRIKETHROUGH");
  });
  it("<s> was-price", () => {
    const r = parsePriceDetailed("<s>24,50 lei</s> 19,90 lei");
    expect(r.referencePriceBani).toBe(2450);
    expect(r.referencePriceKind).toBe("STRIKETHROUGH");
  });
  it('"în loc de" phrasing', () => {
    const r = parsePriceDetailed("14,99 lei in loc de 19,99 lei");
    expect(r.referencePriceBani).toBe(1999);
  });
  it('"preț vechi" phrasing', () => {
    const r = parsePriceDetailed("29,99 lei preț vechi 39,99 lei");
    expect(r.referencePriceBani).toBe(3999);
  });
  // A strikethrough BELOW the current price is a mis-parse — publishing it would invent
  // a discount that does not exist.
  it("rejects a strikethrough that is not above the current price", () => {
    const r = parsePriceDetailed("<del>9,99 lei</del> 14,99 lei");
    expect(r.priceBani).toBe(1499);
    expect(r.referencePriceBani).toBe(undefined);
  });
});

describe("reference price — pages carrying BOTH", () => {
  // Omnibus is the legally-mandated figure, so it wins over a marketing strikethrough.
  it("prefers the Omnibus figure when both are present", () => {
    const r = parsePriceDetailed("<s>24,99 lei</s> 18,99 lei preț minim ultimele 30 de zile: 16,99 lei");
    expect(r.priceBani).toBe(1899);
    expect(r.referencePriceBani).toBe(1699);
    expect(r.referencePriceKind).toBe("OMNIBUS_30D");
  });
  it("real Penny tile: dates + Omnibus + card price", () => {
    const r = parsePriceDetailed(
      "de mi 26.08.2026până ma 01.09.2026preț minim ultimele 30 de zile: 7,99 LEIpreț fără PENNY card11,99 LEI1 KG 11,99 LEI",
    );
    expect(r.priceBani).toBe(1199);
    expect(r.referencePriceBani).toBe(799);
    expect(r.referencePriceKind).toBe("OMNIBUS_30D");
  });
});

describe("reference price — absent", () => {
  it("plain price has no reference", () => {
    const r = parsePriceDetailed("12,99 lei");
    expect(r.priceBani).toBe(1299);
    expect(r.referencePriceBani).toBe(undefined);
    expect(r.referencePriceKind).toBe(undefined);
  });
  it("null input", () => expect(parsePriceDetailed(null).priceBani).toBe(null));
  it("module-level /g regexes are reset between calls (no lastIndex leak)", () => {
    const s = "<del>19,99 lei</del> 14,99 lei";
    const a = parsePriceDetailed(s);
    const b = parsePriceDetailed(s);
    expect(a.referencePriceBani).toBe(b.referencePriceBani);
  });
});
