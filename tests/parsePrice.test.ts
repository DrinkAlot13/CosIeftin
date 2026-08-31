// parsePrice is the single most safety-critical function in the codebase: a locale slip
// here publishes a wrong price on a real product. Every format we have met in the wild,
// plus every trap that has bitten us, is pinned below.
//
// Contract under test: returns INTEGER BANI or null. Never 0.
import { describe, it, expect } from "./run";
import { parsePrice, parseDecimal, formatBani, baniToLei, leiToBaniExact } from "../src/lib/price/parsePrice";

describe("parsePrice — THE regression: FineStore data-price", () => {
  // FineStore served data-price="2,033.39" and the old code read it as 2 lei instead of
  // 2033.39 lei. A 1000× error, live, on a champagne. This case must never regress.
  it('"2,033.39" is 2033,39 lei — NOT 2 lei', () => expect(parsePrice("2,033.39")).toBe(203339));
  it("…and is definitively not 200 bani", () => expect(parsePrice("2,033.39") === 200).toBeFalsy());
  it('"1,498.80" (same source, same format)', () => expect(parsePrice("1,498.80")).toBe(149880));
  it('"10,350.00" stays five figures', () => expect(parsePrice("10,350.00")).toBe(1035000));
});

describe("parsePrice — Romanian decimal comma", () => {
  it('"12,99"', () => expect(parsePrice("12,99")).toBe(1299));
  it('"12,99 lei"', () => expect(parsePrice("12,99 lei")).toBe(1299));
  it('"12,99 RON"', () => expect(parsePrice("12,99 RON")).toBe(1299));
  it('"0,59" (cheap produce)', () => expect(parsePrice("0,59")).toBe(59));
  it('"1,50" keeps the trailing zero', () => expect(parsePrice("1,50")).toBe(150));
});

describe("parsePrice — thousands separators", () => {
  it('RO thousands + decimal comma: "2.033,39"', () => expect(parsePrice("2.033,39")).toBe(203339));
  it('US thousands + decimal dot: "2,033.39"', () => expect(parsePrice("2,033.39")).toBe(203339));
  it('bare RO thousands: "2.033" is 2033 lei', () => expect(parsePrice("2.033")).toBe(203300));
  it('bare US thousands: "2,033" is 2033 lei', () => expect(parsePrice("2,033")).toBe(203300));
  // The token parser understands million-grouping, but a 1.2M-lei grocery price is not a
  // price — the sanity window (1 ban … 1,000,000 lei) rejects it rather than publishing it.
  it('millions parse at token level: "1.234.567"', () => expect(parseDecimal("1.234.567")).toBeCloseTo(1234567));
  it("…but exceed the retail sanity window, so parsePrice returns null", () =>
    expect(parsePrice("1.234.567")).toBe(null));
  it('a large-but-plausible price is kept: "12.499,00 lei"', () => expect(parsePrice("12.499,00 lei")).toBe(1249900));
  it('space-grouped: "2 033,39 lei"', () => expect(parsePrice("2 033,39 lei")).toBe(203339));
  it('plain decimal dot stays decimal: "12.99"', () => expect(parsePrice("12.99")).toBe(1299));
});

describe("parsePrice — exotic whitespace", () => {
  it("non-breaking space (U+00A0) as group separator", () => expect(parsePrice("2 033,39 lei")).toBe(203339));
  it("non-breaking space before the currency", () => expect(parsePrice("12,99 lei")).toBe(1299));
  it("thin space (U+2009)", () => expect(parsePrice("2 033,39 lei")).toBe(203339));
  it("narrow no-break space (U+202F)", () => expect(parsePrice("2 033,39 lei")).toBe(203339));
  it("word joiner (U+2060) inside the amount", () => expect(parsePrice("12⁠,99 lei")).toBe(1299));
});

describe("parsePrice — real store card text", () => {
  it('Carrefour split shelf price: "94 49 Lei"', () => expect(parsePrice("94 49 Lei")).toBe(9449));
  it("Carrefour regular + promo takes the promo", () => expect(parsePrice("94 49 Lei 92 45 Lei")).toBe(9245));
  it('Carrefour three-figure: "262 90 Lei"', () => expect(parsePrice("262 90 Lei")).toBe(26290));
  it('prefer:"first" keeps the regular price', () => expect(parsePrice("94 49 Lei 92 45 Lei", { prefer: "first" })).toBe(9449));
  it("ignores a per-unit clause", () => expect(parsePrice("12 99 lei 25 98 lei/kg")).toBe(1299));
  it("ignores lei/L", () => expect(parsePrice("7,49 lei 4,99 lei/l")).toBe(749));
});

describe("parsePrice — trap 2: promo validity dates are not prices", () => {
  it("a bare date range yields null", () => expect(parsePrice("de mi 26.08.2026 până ma 01.09.2026")).toBe(null));
  it("the real price survives beside its date range", () =>
    expect(parsePrice("de mi 26.08.2026 până ma 01.09.2026 preț fără PENNY card 11,99 LEI")).toBe(1199));
  it("ISO date alone → null", () => expect(parsePrice("2026-08-26")).toBe(null));
  it("slash date alone → null", () => expect(parsePrice("valabil 26/08/2026")).toBe(null));
});

describe("parsePrice — trap 3: the EU 30-day reference price is not the price", () => {
  // Omnibus forces every RO retailer to print the lowest price of the last 30 days.
  // Taken as "the price" it silently understates half the catalog.
  it("reference-only block yields null", () =>
    expect(parsePrice("preț minim ultimele 30 de zile: 7,99 LEI")).toBe(null));
  it("cedilla spelling is handled too", () =>
    expect(parsePrice("preţ minim ultimele 30 de zile: 7,99 LEI")).toBe(null));
  it("current price wins over the reference price", () =>
    expect(parsePrice("preț minim ultimele 30 de zile: 7,99 LEIpreț fără PENNY card11,99 LEI1 KG 11,99 LEI")).toBe(1199));
});

describe("parsePrice — trap 4: footnote markers", () => {
  it('"11,99 LEI1" is 11,99 — not 1 ban', () => expect(parsePrice("preț fără PENNY card11,99 LEI1")).toBe(1199));
  it("a trailing superscript digit never becomes the price", () =>
    expect(parsePrice("15,49 LEI2")).toBe(1549));
});

describe("parsePrice — ambiguity returns null, never 0", () => {
  it("no digits at all", () => expect(parsePrice("preț la raft")).toBe(null));
  it("empty string", () => expect(parsePrice("")).toBe(null));
  it("null input", () => expect(parsePrice(null)).toBe(null));
  it("undefined input", () => expect(parsePrice(undefined)).toBe(null));
  it("literal zero is not a price", () => expect(parsePrice("0")).toBe(null));
  it('"0,00 lei" is not a price', () => expect(parsePrice("0,00 lei")).toBe(null));
  it("several different bare numbers with no currency → ambiguous", () =>
    expect(parsePrice("340 250 128")).toBe(null));
  it("a lone bare number is accepted (data-price attributes)", () => expect(parsePrice("6.49")).toBe(649));
  it("repeated identical bare numbers are NOT ambiguous", () => expect(parsePrice("6,49 6,49")).toBe(649));
  it("absurdly large amount rejected", () => expect(parsePrice("999999999,99 lei")).toBe(null));
  it("never returns 0 for any input", () => {
    for (const s of ["", "0", "0,00", "abc", "0.00 lei", "—", "gratis"]) {
      expect(parsePrice(s) === 0).toBeFalsy();
    }
  });
});

describe("parseDecimal — token-level grouping", () => {
  it("RO decimal comma", () => expect(parseDecimal("12,99")).toBeCloseTo(12.99));
  it("US thousands", () => expect(parseDecimal("2,033.39")).toBeCloseTo(2033.39));
  it("RO thousands", () => expect(parseDecimal("2.033,39")).toBeCloseTo(2033.39));
  it("space-grouped", () => expect(parseDecimal("2 033,39")).toBeCloseTo(2033.39));
  it("no digits → null", () => expect(parseDecimal("abc")).toBe(null));
});

describe("money helpers — integer math only", () => {
  it("formats bani the Romanian way", () => expect(formatBani(203339)).toBe("2.033,39 lei"));
  it("pads the bani part", () => expect(formatBani(650)).toBe("6,50 lei"));
  it("handles sub-leu amounts", () => expect(formatBani(59)).toBe("0,59 lei"));
  it("groups millions", () => expect(formatBani(123456700)).toBe("1.234.567,00 lei"));
  it("round-trips lei → bani → lei", () => expect(baniToLei(leiToBaniExact(12.99))).toBeCloseTo(12.99));
  it("leiToBaniExact avoids float drift", () => expect(leiToBaniExact(0.29 * 3)).toBe(87));
});
