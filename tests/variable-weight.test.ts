// VARIABLE-WEIGHT PARSING — and the cases where it must refuse.
//
// This decides which number becomes a per-kilo price on a page, so a wrong "yes" publishes a
// per-kilo figure as a pack price or the reverse. The refusals below matter more than the
// acceptances: a payload that half-matches is not a variable-weight product with a missing
// field, it is a shape we do not understand.

import { describe, it, expect } from "./run";
import { readVariableWeight, parseApproxSize } from "../src/lib/price/variable-weight";

/** The real Mega Image shape, from offer 478942's stored payload. */
const bananas = {
  value: 8.99, unitPrice: 8.99, unit: "kg", unitCode: "kilogram",
  supplementaryPriceLabel1: "+/- 8.99 LEI",
  supplementaryPriceLabel2: "+/- 1.000 Kg",
  currencyIso: "RON",
};

/** The offer that started this: 35.99/kg x 0.700 kg = 25.19 at the till. */
const fleica = {
  value: 25.19, unitPrice: 35.99, unit: "kg",
  supplementaryPriceLabel1: "+/- 25.19 LEI",
  supplementaryPriceLabel2: "+/- 0.700 Kg",
};

describe("parseApproxSize", () => {
  it("reads kilograms", () => {
    expect(parseApproxSize("+/- 0.700 Kg")?.size).toBeCloseTo(0.7, 5);
    expect(parseApproxSize("+/- 0.700 Kg")?.unit).toBe("kg");
  });
  it("converts grams to kilograms, because the rest of the system is canonical", () => {
    expect(parseApproxSize("+/- 250 g")?.size).toBeCloseTo(0.25, 5);
    expect(parseApproxSize("+/- 250 g")?.unit).toBe("kg");
  });
  it("accepts a decimal comma, which Romanian labels use", () => {
    expect(parseApproxSize("+/- 1,5 Kg")?.size).toBeCloseTo(1.5, 5);
  });
  it("refuses a label that is not an approximate weight", () => {
    expect(parseApproxSize("8,99 Lei") === null).toBe(true);
    expect(parseApproxSize("+/- 25.19 LEI") === null).toBe(true);
    expect(parseApproxSize(null) === null).toBe(true);
  });
});

describe("readVariableWeight — the shape it accepts", () => {
  it("reads the three facts from a real payload", () => {
    const v = readVariableWeight(fleica);
    expect(v?.quotedUnitPrice).toBe(35.99);
    expect(v?.unit).toBe("kg");
    expect(v?.approxSize).toBeCloseTo(0.7, 5);
    expect(v?.approxPrice).toBe(25.19);
  });

  it("keeps the MERCHANT'S per-kilo price, never one derived from the approximate weight", () => {
    // 25.19 / 0.7 = 35.9857…, which is NOT 35.99. Deriving would publish a number the shop
    // never quoted, wrong by however much the piece differs from typical.
    const v = readVariableWeight(fleica);
    expect(v?.quotedUnitPrice).toBe(35.99);
  });

  it("accepts a 1 kg pack where the two prices coincide", () => {
    expect(readVariableWeight(bananas)?.quotedUnitPrice).toBe(8.99);
  });
});

describe("readVariableWeight — what it must REFUSE", () => {
  it("an ordinary fixed pack with no weight label", () => {
    expect(readVariableWeight({ value: 8.99, unitPrice: 8.99, unit: "kg" }) === null).toBe(true);
  });

  it("a payload whose numbers DISAGREE — the shape means something else", () => {
    // 35.99 x 0.7 = 25.19, not 99.99. Half-matching is not a missing field.
    expect(readVariableWeight({ ...fleica, value: 99.99 }) === null).toBe(true);
  });

  it("a quote in a different unit from its own weight label", () => {
    expect(readVariableWeight({ ...fleica, unit: "l" }) === null).toBe(true);
  });

  it("a missing or zero unit price", () => {
    expect(readVariableWeight({ ...fleica, unitPrice: 0 }) === null).toBe(true);
    expect(readVariableWeight({ ...fleica, unitPrice: undefined }) === null).toBe(true);
  });

  it("anything that is not an object", () => {
    expect(readVariableWeight(null) === null).toBe(true);
    expect(readVariableWeight("35.99") === null).toBe(true);
  });

  it("tolerates the merchant's own rounding but not a real disagreement", () => {
    // 3% band: 35.99 x 0.7 = 25.193, so 25.19 and 25.20 are the same claim.
    expect(readVariableWeight({ ...fleica, value: 25.20 }) !== null).toBe(true);
    // 20% out is a different number, not rounding.
    expect(readVariableWeight({ ...fleica, value: 30.0 }) === null).toBe(true);
  });
});
