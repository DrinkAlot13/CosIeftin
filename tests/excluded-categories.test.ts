// Tobacco is refused at the pool, and the Romanian near-misses are the whole test.
//
// Legea 349/2002 prohibits advertising and promotion of tobacco products; Legea 201/2016
// extends it to electronic cigarettes and refills. A public price-comparison page is not an
// obvious fit for the narrow exceptions, and a grocery basket optimiser has no reason to
// carry tobacco at all — so it is excluded structurally rather than at display time.
//
// The risk in a word list is the other direction: eating real groceries. `tigaie` is a frying
// pan, one letter from `tigari`. `foi de dafin` is bay leaf. `rezerve odorizant` is an air
// freshener refill and Mega Image sells far more of those than tobacco refills.
import { describe, it, expect } from "./run";
import { isExcluded, exclusionReason } from "../src/lib/excluded-categories";

describe("excluded categories — tobacco is refused", () => {
  it("excludes the plain forms, with and without diacritics", () => {
    for (const n of [
      "Tigari Marlboro Gold 20 buc",
      "Țigări Kent Silver",
      "Tutun de rulat Golden Virginia 30g",
      "Trabuc Cohiba",
      "Rezerve de tutun Wind Fuse",
      "Rezerve de tutun Classic Silver",
      "Pliculete cu nicotina Tropical Mango, 8mg",
      "Narghilea completa",
      "Snus Original Portion",
    ]) {
      expect(isExcluded(n)).toBe(true);
    }
  });

  it("excludes heated-tobacco and vape brands", () => {
    expect(isExcluded("IQOS Originals Duo")).toBe(true);
    expect(isExcluded("HEETS Amber Selection")).toBe(true);
    expect(isExcluded("Tigara electronica Elf Bar 600")).toBe(true);
  });

  it("excludes cigars only in the phrase, not the bay leaf", () => {
    expect(isExcluded("Tigari de foi Handelsgold")).toBe(true);
    expect(isExcluded("Foi de dafin Kotanyi 10 g")).toBe(false);
  });

  it("does NOT exclude a frying pan", () => {
    // `tigaie` is one letter from `tigari` and is a real product. Whole-word matching is
    // what makes this safe; a substring check would have eaten it.
    expect(isExcluded("Tigaie Tefal 24 cm")).toBe(false);
    expect(isExcluded("Tigai antiaderente set 3 buc")).toBe(false);
  });

  it("does NOT exclude air-freshener or printer refills", () => {
    expect(isExcluded("Rezerve odorizant pentru toaleta Duck Hibiscus")).toBe(false);
    expect(isExcluded("Rezerva de mop")).toBe(false);
    expect(isExcluded("Cartus cerneala HP 305")).toBe(false);
  });

  it("does NOT exclude ordinary groceries that collide with short brand names", () => {
    // `glo`, `heat`, `elf` are tobacco brands and also ordinary tokens.
    expect(isExcluded("Sos Glotex pentru paste")).toBe(false);
    expect(isExcluded("Elf Bar de ciocolata")).toBe(false);
    expect(isExcluded("Ready to heat orez basmati")).toBe(false);
  });

  it("excludes an ambiguous brand once a second signal is present", () => {
    expect(isExcluded("glo Hyper X2 dispozitiv tutun")).toBe(true);
    expect(isExcluded("VEEV NOW pods nicotina")).toBe(true);
  });

  it("reports a reason rather than a bare boolean", () => {
    // An exclusion must be distinguishable from a parse failure in the counts.
    expect(exclusionReason("Tigari Marlboro")).toBe("tobacco");
    expect(exclusionReason("Lapte Zuzu 1.5 l")).toBe(null);
  });
});
