// FLAVOUR FOLDING — every merge is enumerated, and the dangerous near-misses stay apart.
//
// `variantConflict` raises a HARD REJECT before anything is scored, so a wrong merge here is
// not a lost comparison — it publishes one flavour's price on another, and does it silently,
// because a REJECT never reaches the review queue for anyone to see.
//
// So this file exists to make the folding READABLE and to pin the pairs that must never merge.
// Romanian inflection puts real traps one letter apart: `mure` (blackberry) against `mere`
// (apple), `para` (pear) against `paprica`. Any future move to an algorithmic stemmer trips
// these immediately, which is the point.

import { describe, it, expect } from "./run";
import {
  variantConflict, FLAVOUR_CANON, FLAVOUR_FOLDING_GROUPS, VARIANT_CLASSES,
} from "../src/lib/variant-classes";

describe("flavour folding — what it merges", () => {
  it("every group is a genuine set of inflections of ONE flavour", () => {
    // Printed rather than asserted-and-hidden: this list is the thing a person must read.
    const rendered = FLAVOUR_FOLDING_GROUPS.map((g) => g.join(" = ")).sort();
    expect(rendered).toEqual([
      "afine = afina",
      "alune = aluna",
      "banane = banana",
      "capsuni = capsuna",
      "cirese = cireasa",
      "mere = mar",
      "mure = mura",
      "pere = para",
      "piersici = piersica",
      "portocale = portocala",
      "struguri = strugure",
      "visine = visina",
      "zmeura = zmeure",
    ]);
  });

  it("every folded form is also a listed flavour — folding cannot invent a value", () => {
    for (const [form] of FLAVOUR_CANON) {
      expect(VARIANT_CLASSES.flavour.has(form)).toBe(true);
    }
  });

  it("no two DIFFERENT flavours share a canonical form", () => {
    // The guard against a stemmer creeping in: count distinct canonical values and make sure
    // folding collapsed exactly the groups above and nothing else.
    const canon = new Set([...VARIANT_CLASSES.flavour].map((f) => FLAVOUR_CANON.get(f) ?? f));
    expect(VARIANT_CLASSES.flavour.size - canon.size).toBe(FLAVOUR_FOLDING_GROUPS.length);
  });
});

describe("flavour folding — the pairs that must NEVER merge", () => {
  const distinct: [string, string][] = [
    ["Suc de mure 1 l", "Suc de mere 1 l"],           // blackberry vs apple, one letter apart
    ["Suc de lamaie 1 l", "Suc de lime 1 l"],          // lemon vs lime
    ["Iaurt cu visine 150 g", "Iaurt cu vanilie 150 g"],
    ["Ceai de afine 20 plicuri", "Ceai de alune 20 plicuri"],
    ["Suc de pere 1 l", "Suc de piersici 1 l"],
  ];
  for (const [a, b] of distinct) {
    it(`${a}  !=  ${b}`, () => {
      const c = variantConflict(a, b);
      // These are different flavours and must still conflict.
      expect(c !== null).toBe(true);
      expect(c?.klass).toBe("flavour");
    });
  }
});

describe("flavour folding — the pairs that must now agree", () => {
  const same: [string, string][] = [
    ["Suc de portocale Olympus, 0.5 l", "OLYMPUS Suc de portocala 500 ml"],
    ["Bautura necarbogazoasa cu aroma de piersica 1.5 l", "Bautura necarbogazoasa piersici 1.5 l"],
    ["Cidru Mere 0,33 L", "CIDRU MAR 0,33 L"],
    ["Iaurt cu capsuni 150 g", "Iaurt cu capsuna 150 g"],
  ];
  for (const [a, b] of same) {
    it(`${a}  ==  ${b}`, () => {
      // Same flavour, two inflections.
      expect(variantConflict(a, b) === null).toBe(true);
    });
  }
});

describe("flavour folding — silence is still not disagreement", () => {
  it("one name stating a flavour and the other saying nothing does not conflict", () => {
    expect(variantConflict("Suc de portocale 1 l", "Suc natural 1 l") === null).toBe(true);
  });
});
