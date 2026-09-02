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

// Every notation named in the Phase 1a spec, plus the guards that stop the parser from
// inventing promotions. `isPromoPack` is the field shrinkflation detection depends on: an
// 8x125 -> 7x125 transition is promo expiry, not a shrunk pack, and only this flag can tell
// the two apart.
describe("parseQuantity — the full promo-pack contract", () => {
  it("packCount always equals paidCount + freeCount", () => {
    for (const name of [
      "Iaurt (7+1) x 125 g", "Iaurt 4+2 x 125 g", "Cafea 250 g 2+1 gratis",
      "Sampon 400 ml 1+1 gratis", "Ciocolata 100 g 3 la pretul de 2",
      "Bere 6 x 1,5 L", "Detergent 2 x 500 g + 1 gratis", "Faina 1 kg",
      "Servetele pachet 2 buc", "Hartie igienica 12 role",
    ]) {
      const q = parseQuantity(name)!;
      expect(q.packCount).toBe(q.paidCount + q.freeCount);
    }
  });

  it("(7+1) x 125 g — pays for 7, takes home 8", () => {
    const q = parseQuantity("Iaurt natur Activia, (7+1) x 125 g")!;
    expect(q.paidCount).toBe(7); expect(q.freeCount).toBe(1);
    expect(q.packCount).toBe(8); expect(q.value).toBe(1000);
    expect(q.isPromoPack).toBeTruthy();
  });

  it("4+2 x 125 g — pays for 4, takes home 6", () => {
    const q = parseQuantity("Iaurt 4+2 x 125 g")!;
    expect(q.paidCount).toBe(4); expect(q.freeCount).toBe(2);
    expect(q.value).toBe(750); expect(q.isPromoPack).toBeTruthy();
  });

  it('"2+1 gratis" multiplies the size stated elsewhere in the name', () => {
    const q = parseQuantity("Cafea Jacobs 250 g 2+1 gratis")!;
    expect(q.paidCount).toBe(2); expect(q.freeCount).toBe(1);
    expect(q.packCount).toBe(3); expect(q.value).toBe(750);
    expect(q.packSize).toBe(250); expect(q.unit).toBe("G");
  });

  it('"1+1 gratis" is a two-pack', () => {
    const q = parseQuantity("Sampon Head&Shoulders 400 ml 1+1 GRATIS")!;
    expect(q.packCount).toBe(2); expect(q.value).toBe(800);
    expect(q.paidCount).toBe(1); expect(q.freeCount).toBe(1);
  });

  it('"gratuit" and "cadou" are the same offer', () => {
    expect(parseQuantity("Gel de dus 250 ml 1+1 gratuit")!.packCount).toBe(2);
    expect(parseQuantity("Crema 50 ml 2+1 cadou")!.packCount).toBe(3);
  });

  it('"3 la prețul de 2" — three items, two paid', () => {
    const q = parseQuantity("Ciocolata Milka 100 g, 3 la prețul de 2")!;
    expect(q.packCount).toBe(3); expect(q.paidCount).toBe(2); expect(q.freeCount).toBe(1);
    expect(q.value).toBe(300); expect(q.isPromoPack).toBeTruthy();
  });

  it("…and in the diacritic-free spelling scrapers actually emit", () => {
    const q = parseQuantity("Ciocolata 100 g 3 la pretul de 2")!;
    expect(q.packCount).toBe(3); expect(q.paidCount).toBe(2);
  });

  it('"6 x 1,5 L" is a multipack and NOT a promo', () => {
    const q = parseQuantity("Apa minerala Borsec 6 x 1,5 L")!;
    expect(q.packCount).toBe(6); expect(q.value).toBe(9000);
    expect(q.paidCount).toBe(6); expect(q.freeCount).toBe(0);
    expect(q.isPromoPack).toBeFalsy();
  });

  it('"2 x 500 g + 1 gratis" adds one item of the pack\'s own size', () => {
    const q = parseQuantity("Detergent 2 x 500 g + 1 gratis")!;
    expect(q.packCount).toBe(3); expect(q.paidCount).toBe(2); expect(q.freeCount).toBe(1);
    expect(q.packSize).toBe(500); expect(q.value).toBe(1500);
  });

  it('"1+1 gratis" with no size at all is two pieces, not a guessed mass', () => {
    const q = parseQuantity("Periuta de dinti Oral-B 1+1 gratis")!;
    expect(q.unit).toBe("BUC"); expect(q.packCount).toBe(2);
    expect(q.paidCount).toBe(1); expect(q.freeCount).toBe(1);
  });

  it("a promo on a multipack counts whole packs", () => {
    const q = parseQuantity("Hartie igienica 8 role 2+1 gratis")!;
    expect(q.packCount).toBe(3); expect(q.value).toBe(24); expect(q.unit).toBe("BUC");
  });

  it("pack words: pachet / set / bax", () => {
    expect(parseQuantity("Servetele pachet 2 buc")!.packCount).toBe(2);
    expect(parseQuantity("Set 3 buc prosoape")!.packCount).toBe(3);
    expect(parseQuantity("Bere Ciuc bax 24")!.value).toBe(24);
    expect(parseQuantity("Bere Ciuc bax 24")!.unit).toBe("BUC");
  });

  it("a bax that states the bottle size is a real multipack", () => {
    const q = parseQuantity("Apa Dorna bax 24 x 0,5 l")!;
    expect(q.packCount).toBe(24); expect(q.value).toBe(12000);
  });

  it("counting nouns: 12 role, 10 buc", () => {
    expect(parseQuantity("Hartie igienica Zewa 12 role")!.value).toBe(12);
    expect(parseQuantity("Oua de gaina 10 buc")!.value).toBe(10);
  });

  it("a percentage in the name is still not a size", () => {
    const q = parseQuantity("Lapte Zuzu 1,5% grăsime 1 L")!;
    expect(q.value).toBe(1000); expect(q.unit).toBe("ML"); expect(q.isPromoPack).toBeFalsy();
  });
});

// The parser must not invent promotions. Romanian labels are full of innocent plus signs, and
// a false promo corrupts a real quantity — worse than missing a promo label entirely.
describe("parseQuantity — a bare plus sign is not a promotion", () => {
  it("Omega 3+6+9 is not a 3-paid-6-free offer", () => {
    const q = parseQuantity("Omega 3+6+9 Doppelherz, 60 capsule")!;
    expect(q.isPromoPack).toBeFalsy();
    expect(q.value).toBe(60); expect(q.unit).toBe("BUC");
  });
  it('"90 Gr+" grading is not a promotion', () => {
    const q = parseQuantity("ECO Avocado 90 Gr+ 1 buc")!;
    expect(q.isPromoPack).toBeFalsy();
  });
  it("an age label is not a promotion", () => {
    const q = parseQuantity("Puzzle 3+ ani, 250 g")!;
    expect(q.isPromoPack).toBeFalsy();
    expect(q.value).toBe(250);
  });
  it("a plain product keeps paidCount = packCount and freeCount = 0", () => {
    const q = parseQuantity("Faina alba 1 kg")!;
    expect(q.paidCount).toBe(1); expect(q.freeCount).toBe(0); expect(q.isPromoPack).toBeFalsy();
  });
});

// Found by dry-running the unitSize backfill over the live catalog: 37 farmacie products were
// stored as their DOSE because the dose form was not a counting noun, and DCNeu bundle packs
// were stored as one half of the bundle.
describe("parseQuantity — pharmacy dose forms are counting nouns", () => {
  it("24 drajeuri beats the 400 mg dose", () => {
    const q = parseQuantity("Nurofen Immedia Ultra, 400 mg, 24 drajeuri, Reckitt")!;
    expect(q.value).toBe(24); expect(q.unit).toBe("BUC");
  });
  it("pastile", () => expect(parseQuantity("Strepsils Intensiv, 8,75 mg, 24 pastile")!.value).toBe(24));
  it("supozitoare", () => expect(parseQuantity("Glicerina 12 supozitoare")!.value).toBe(12));
  it("fiole", () => expect(parseQuantity("Magneziu 10 fiole")!.value).toBe(10));
  it("ovule", () => expect(parseQuantity("Canesten 6 ovule")!.value).toBe(6));
  it("perle", () => expect(parseQuantity("Ulei de peste 60 perle")!.value).toBe(60));
  it("comprimate still wins over a dose", () => {
    expect(parseQuantity("Magnerot, 500 mg, 100 comprimate")!.value).toBe(100);
  });
  it("a genuine milligram size is still read when nothing counts it", () => {
    expect(parseQuantity("Vitamina C pulbere 500 mg")!.unit).toBe("G");
  });
});

describe("parseQuantity — bundled COUNTS add up; bundled masses do not", () => {
  it("32BUC+20BUC is 52 pads", () => {
    const q = parseQuantity("LIBRESSE ABSORBANTE ZILNICE 32BUC+20BUC REGULAR DAILY FRESH")!;
    expect(q.value).toBe(52); expect(q.unit).toBe("BUC");
  });
  it("a single count with a trailing word is unaffected", () => {
    expect(parseQuantity("ALWAYS ABSORBANTE 12BUC PLATINUM SUPER EXTRA+DISCREET")!.value).toBe(12);
  });
  it("REFUSES to sum a dosage pair — that is a concentration, and the pack is stated after", () => {
    const q = parseQuantity("Crema rectala Procto-Glyvenol, 50 mg + 20 mg/g, 30 g")!;
    expect(q.value).toBe(30); expect(q.unit).toBe("G");
  });
  it("REFUSES to sum a mixed-unit gift set", () => {
    // No single size exists here. Whatever it returns, it must not be 250+90.
    const q = parseQuantity("DOVE CASETA CADOU (SG250ML+SP90G+BURETE) GENTLE PAMPER")!;
    expect(q.value === 340).toBeFalsy();
  });
});

// ── BONUS PACKS: a measured base plus a measured bonus of the same dimension ────────────
//
// Found by Kaufland's `formattedBasePrice` — a per-unit price the merchant computes from the
// real pack size, and the only check in this project that shares no assumption with our
// parser, our matcher or our size handling. It said 14,28 lei/kg for Edenia Amestec Mexican
// while we said 57,55: we had read "1kg+330g" as 330 g and thrown the kilogram away. A 4x
// error, on the shelf, invisible to every check we owned.
//
// The rule that separates this from the bare `N+M` which is NOT a promotion: both sides must
// carry a unit, of the same dimension.
describe("parseQuantity — bonus packs (base + measured bonus)", () => {
  it("reads 1kg+330g as 1.33 kg, not 330 g", () => {
    const q = parseQuantity("Edenia Amestec Mexican 1kg+330g")!;
    expect(q.value).toBe(1330);
    expect(q.unit).toBe("G");
  });

  it("marks it promotional, so a shrinkflation detector ignores the reversion", () => {
    // The pack goes back to 1 kg when the promo ends. That is not shrinkflation.
    expect(parseQuantity("1kg+330g")!.isPromoPack).toBe(true);
    // ...but nothing is FREE by the item, so the counts stay honest.
    expect(parseQuantity("1kg+330g")!.freeCount).toBe(0);
    expect(parseQuantity("1kg+330g")!.packCount).toBe(1);
  });

  it("handles the spaced and gratis-suffixed forms", () => {
    expect(parseQuantity("500 g + 150 g gratis")!.value).toBe(650);
    expect(parseQuantity("2 l+0,5 l")!.value).toBe(2500);
    expect(parseQuantity("2 l+0,5 l")!.unit).toBe("ML");
  });

  it("REFUSES mixed dimensions — that is a bundle, not a bigger pack", () => {
    // "1 kg + 500 ml" is two different products sold together. Summing them would invent a
    // quantity that does not exist.
    const q = parseQuantity("1 kg + 500 ml")!;
    expect(q.value === 1500 && q.unit === "G").toBe(false);
  });

  it("still refuses the bare N+M shapes that are not promotions at all", () => {
    // CLAUDE.md: inventing a promotion out of these corrupts a real quantity, which is worse
    // than missing a label. Neither side carries a unit, so the bonus rule cannot fire.
    expect(parseQuantity("Omega 3+6+9")).toBe(null);
    expect(parseQuantity("3+ ani")).toBe(null);
    expect(parseQuantity("90 Gr+")!.value).toBe(90);
    expect(parseQuantity("90 Gr+")!.isPromoPack).toBe(false);
  });

  it("leaves every existing promo shape untouched", () => {
    const a = parseQuantity("(7+1) x 125 g")!;
    expect(a.value).toBe(1000);
    expect(a.paidCount).toBe(7);
    expect(a.freeCount).toBe(1);
    const b = parseQuantity("2+1 gratis")!;
    expect(b.packCount).toBe(3);
    const c = parseQuantity("6x1.5L")!;
    expect(c.value).toBe(9000);
    expect(c.isPromoPack).toBe(false);
  });
});
