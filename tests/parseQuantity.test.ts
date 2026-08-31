// Pack-size parsing. Canonical units are G / ML / BUC, and multipacks must expand to a
// total WITHOUT losing the pack shape (see CLAUDE.md → Units).
import { describe, it, expect } from "./run";
import { parseQuantity, formatQuantity, perUnitDivisor } from "../src/lib/units/parseQuantity";

describe("parseQuantity — the cases named in the spec", () => {
  it('"500 g"', () => {
    const q = parseQuantity("Făină albă 500 g")!;
    expect(q.value).toBe(500); expect(q.unit).toBe("G"); expect(q.packCount).toBe(1);
  });
  it('"0,5 kg" normalizes to grams', () => {
    const q = parseQuantity("Zahăr 0,5 kg")!;
    expect(q.value).toBe(500); expect(q.unit).toBe("G");
  });
  it('"1,5 L" normalizes to millilitres', () => {
    const q = parseQuantity("Apă plată 1,5 L")!;
    expect(q.value).toBe(1500); expect(q.unit).toBe("ML");
  });
  it('"250ml" without a space', () => {
    const q = parseQuantity("Smântână 250ml")!;
    expect(q.value).toBe(250); expect(q.unit).toBe("ML");
  });
  it('"10 bucăți"', () => {
    const q = parseQuantity("Ouă mărimea M 10 bucăți")!;
    expect(q.value).toBe(10); expect(q.unit).toBe("BUC");
  });
});

describe("parseQuantity — multipacks expand but keep their shape", () => {
  it('"6x1.5L" is 9000 ML AND a six-pack', () => {
    const q = parseQuantity("Apă minerală 6x1.5L")!;
    expect(q.value).toBe(9000);
    expect(q.unit).toBe("ML");
    expect(q.packCount).toBe(6);
    expect(q.packSize).toBe(1500);
  });
  it("6x1.5L is NOT silently treated as 1.5L", () => {
    expect(parseQuantity("Apă 6x1.5L")!.value === 1500).toBeFalsy();
  });
  it('"3 buc x 100g" is 300 G in three pieces', () => {
    const q = parseQuantity("Cașcaval feliat 3 buc x 100g")!;
    expect(q.value).toBe(300); expect(q.packCount).toBe(3); expect(q.packSize).toBe(100);
  });
  it('"4 x 330 ml" with spaces', () => {
    const q = parseQuantity("Bere 4 x 330 ml")!;
    expect(q.value).toBe(1320); expect(q.packCount).toBe(4);
  });
  it('"2×1,5l" with the × character and RO comma', () => {
    const q = parseQuantity("Suc 2×1,5l")!;
    expect(q.value).toBe(3000); expect(q.packCount).toBe(2); expect(q.packSize).toBe(1500);
  });
  it('reversed form "1.5L x 6"', () => {
    const q = parseQuantity("Apă 1.5L x 6")!;
    expect(q.value).toBe(9000); expect(q.packCount).toBe(6);
  });
});

describe("parseQuantity — unit normalization", () => {
  it("kg → G", () => expect(parseQuantity("Orez 1 kg")!.value).toBe(1000));
  it("gr → G", () => expect(parseQuantity("Drojdie 42 gr")!.value).toBe(42));
  it("cl → ML", () => expect(parseQuantity("Vin 75 cl")!.value).toBe(750));
  it("l → ML", () => expect(parseQuantity("Ulei 1 l")!.value).toBe(1000));
  it("mg → G (sub-gram precision kept)", () => expect(parseQuantity("Vitamina C 500 mg")!.value).toBeCloseTo(0.5, 3));
  it("capsule → BUC", () => expect(parseQuantity("Omega 3, 60 capsule")!.unit).toBe("BUC"));
  it("comprimate → BUC", () => expect(parseQuantity("Paracetamol 20 comprimate")!.unit).toBe("BUC"));
  it("role → BUC", () => expect(parseQuantity("Hârtie igienică 10 role")!.value).toBe(10));
});

describe("parseQuantity — traps in real Romanian names", () => {
  // "Lapte 1,5% grăsime 1L" — the fat percentage must not be read as the size.
  it("fat percentage is not a size", () => {
    const q = parseQuantity("Lapte Zuzu 1,5% grăsime 1L")!;
    expect(q.value).toBe(1000); expect(q.unit).toBe("ML");
  });
  it("alcohol percentage is not a size", () => {
    const q = parseQuantity("Whisky Glenfiddich 12YO, 40% alc., 0,7 l")!;
    expect(q.value).toBe(700); expect(q.unit).toBe("ML");
  });
  it("takes the LAST size when several appear", () => {
    const q = parseQuantity("Set 2 pahare 250 ml")!;
    expect(q.unit).toBe("ML"); expect(q.value).toBe(250);
  });
  it("cedilla spelling of bucăţi still counts", () =>
    expect(parseQuantity("Ouă 10 bucăţi")!.unit).toBe("BUC"));
  it("no size declared → null", () => expect(parseQuantity("Pâine feliată")).toBe(null));
  it("empty input → null", () => expect(parseQuantity("")).toBe(null));
  it("null input → null", () => expect(parseQuantity(null)).toBe(null));
});

describe("formatQuantity + perUnitDivisor", () => {
  it("renders a multipack in its pack shape", () =>
    expect(formatQuantity(parseQuantity("Apă 6x1.5L")!)).toBe("6 x 1,5 l"));
  it("renders a single item", () =>
    expect(formatQuantity(parseQuantity("Făină 500 g")!)).toBe("500 g"));
  it("promotes grams to kg when large", () =>
    expect(formatQuantity(parseQuantity("Orez 1 kg")!)).toBe("1 kg"));
  it("per-unit divisor for mass is in kg", () => {
    const d = perUnitDivisor(parseQuantity("Făină 500 g")!);
    expect(d.divisor).toBeCloseTo(0.5); expect(d.label).toBe("kg");
  });
  it("per-unit divisor for a multipack uses the TOTAL", () => {
    const d = perUnitDivisor(parseQuantity("Apă 6x1.5L")!);
    expect(d.divisor).toBeCloseTo(9); expect(d.label).toBe("l");
  });
  it("per-unit divisor for counts is pieces", () => {
    const d = perUnitDivisor(parseQuantity("Ouă 10 buc")!);
    expect(d.divisor).toBe(10); expect(d.label).toBe("buc");
  });
});

describe("parseQuantity — promotional 'N+M' multipacks (found by the DB audit)", () => {
  // The cross-store median check flagged "Iaurt natur Activia, (7+1) x 125 g" at 14,63 lei
  // against a median of 2,59 — because the pack parsed as a single 125 g pot instead of
  // eight. Romanian retail writes "buy N get M free" this way constantly.
  it("(7+1) x 125 g is an EIGHT-pack, not one pot", () => {
    const q = parseQuantity("Iaurt natur Activia, (7+1) x 125 g")!;
    expect(q.packCount).toBe(8);
    expect(q.value).toBe(1000);
    expect(q.packSize).toBe(125);
  });
  it("(7+1) x 130 g", () => {
    const q = parseQuantity("Iaurt natur Danone, (7+1) x 130 g")!;
    expect(q.packCount).toBe(8);
    expect(q.value).toBe(1040);
  });
  it("without parentheses: 4+2 x 125 g is a six-pack", () => {
    const q = parseQuantity("Iaurt 4+2 x 125 g")!;
    expect(q.packCount).toBe(6);
    expect(q.value).toBe(750);
  });
  it("volume promo: 5+1 x 0.5L is six bottles", () => {
    const q = parseQuantity("Bere 5+1 x 0.5L")!;
    expect(q.packCount).toBe(6);
    expect(q.value).toBe(3000);
  });
  it("a plain multipack still parses normally", () => {
    const q = parseQuantity("Apa 6x1.5L")!;
    expect(q.packCount).toBe(6);
    expect(q.value).toBe(9000);
  });
  it("a single item is unaffected", () => expect(parseQuantity("Lapte 1L")!.packCount).toBe(1));
});
