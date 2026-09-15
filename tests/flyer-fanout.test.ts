// The flyer fan-out rule, graded against real names — written BEFORE the fix landed in
// scrape-util.ts, per CLAUDE.md's own rule: a matcher change is measured against real names,
// never tuned against them. See docs/SOAK.md, 2026-09-15, and scripts/withhold-flyer-fanout.ts
// for the live incident this generalizes.
//
// ── WHY THIS IS NOT A pairs.ts CASE.
//
// pairs.ts / matching.test.ts grade `matchDecision(a, b)` — a PURE pairwise question. The flyer
// defect is not a pairwise defect: "Nivea Gel de duş 500 ml" against ANY ONE of the 12 gels,
// taken alone, is a perfectly reasonable "could be this" call, and `decide()` is right to clear
// it. The failure only exists in AGGREGATE — the same physical store item clearing 12 pairwise
// decisions at once — so grading it as a pairs.ts SHOULD_NOT_MATCH entry would be false: it
// would demand `decide()` reject a pairing that is fine in isolation, which would cost every
// OTHER catalog where a generic flyer name has exactly one real candidate.
//
// So this exercises the real multi-candidate arbitration this rule actually lives in:
// `resolveFlyerFanout`, which runs `prep()` + `decide()` against every candidate exactly as
// PHASE 1 of `matchPoolToCatalog` does, then applies the same veto.
import { describe, it, expect } from "./run";
import { resolveFlyerFanout, type FanoutCandidate } from "../src/lib/scrape-util";

const cand = (name: string, productId: number, brand: string | null = null): FanoutCandidate =>
  ({ productId, name, brand, ean: null, unit: "l", unitSize: 0.5 });

describe("flyer fan-out — the three live cases, real names", () => {
  it("REGRESSION: Nivea Gel de duş 500 ml no longer matches all 12 shower gels", () => {
    const candidates = [
      cand("Gel de dus Nivea lemongrass & oil, 500ml", 7341, "Nivea"),
      cand("Gel de dus Nivea Care & Orange 500 ml", 7450, "Nivea"),
      cand("Gel de dus Nivea Power Refresh, 500 ml", 7522, "Nivea"),
      cand("Gel de dus Nivea Creme Soft, 500ml", 42671, "Nivea"),
      cand("Gel de dus Nivea Creme Care, 500ml", 42715, "Nivea"),
      cand("Gel de dus Nivea Care & Roses, 500 ml", 42746, "Nivea"),
      cand("Gel de dus Nivea Care & Diamond, 500ml", 42747, "Nivea"),
      cand("Gel de dus Nivea Care & Starfruit, 500ml", 42848, "Nivea"),
      cand("Gel de dus Nivea Creme Smooth, 500ml", 42921, "Nivea"),
      cand("Nivea Gel Dus Frangipani&Oil 500Ml", 71319, "Nivea"),
      cand("Nivea Gel De Dus Deep 500Ml", 123479, "Nivea"),
      cand("Nivea Gel De Dus Pure Impact 500Ml", 123480, "Nivea"),
    ];
    const r = resolveFlyerFanout({ name: "Nivea Gel de duş 500 ml", brand: "Nivea", ean: null, unit: "l", unitSize: 0.5 }, candidates, "grocery");
    expect(r.refusedFanout).toBe(true);
    expect(r.confirmed.length).toBe(0);
  });

  it("REGRESSION: Lay's Chipsuri 170 g no longer matches all 7 flavours", () => {
    const candidates = [
      cand("Chipsuri cu sare Lay's, 170 g", 3884, "Lay's"),
      cand("Chipsuri cu smantana si marar Lay's, 170 g", 3928, "Lay's"),
      cand("Chipsuri cu paprika Lay's, 170 g", 4012, "Lay's"),
      cand("Chipsuri cu cascaval Lay's, 170 g", 4130, "Lay's"),
      cand("Lay's Chips cu sare 170 g", 15748, "Lay's"),
      cand("Lay's Chips cu smantana si marar 170 g", 15750, "Lay's"),
      cand("Lay's Chips cu paprika 170 g", 15758, "Lay's"),
    ].map((c) => ({ ...c, unit: "kg", unitSize: 0.17 }));
    const r = resolveFlyerFanout({ name: "Lay's Chipsuri 170 g", brand: "Lay's", ean: null, unit: "kg", unitSize: 0.17 }, candidates, "grocery");
    expect(r.refusedFanout).toBe(true);
    expect(r.confirmed.length).toBe(0);
  });

  it("REGRESSION: Dove Deodorant spray 150 ml no longer matches all 6 scents", () => {
    const candidates = [
      cand("Dove Deodorant Spray Proaspat 150 ml", 11645, "Dove"),
      cand("Dove Deo Spray Apple 150Ml", 71458, "Dove"),
      cand("Dove Deo Spray Rodie 150Ml", 71496, "Dove"),
      cand("Dove Deo Spray Invisible Dry 150Ml", 123504, "Dove"),
      cand("Dove Deo Spray Original 150Ml", 131718, "Dove"),
      cand("Dove Deo Spray Fresh 150Ml", 131719, "Dove"),
    ].map((c) => ({ ...c, unit: "l", unitSize: 0.15 }));
    const r = resolveFlyerFanout({ name: "Dove Deodorant spray 150 ml", brand: "Dove", ean: null, unit: "l", unitSize: 0.15 }, candidates, "grocery");
    expect(r.refusedFanout).toBe(true);
    expect(r.confirmed.length).toBe(0);
  });
});

describe("flyer fan-out — control cases, so the rule does not over-fire", () => {
  it("a single real candidate still matches — most flyer lines are fine", () => {
    // Real case from the same Kaufland run: no fan-out, exactly one candidate.
    const candidates = [cand("Paine cu cartofi 400 g", 90001)].map((c) => ({ ...c, unit: "kg", unitSize: 0.4 }));
    const r = resolveFlyerFanout({ name: "Paine cu cartofi 400 g", brand: null, ean: null, unit: "kg", unitSize: 0.4 }, candidates, "grocery");
    expect(r.refusedFanout).toBe(false);
    expect(r.confirmed).toEqual([90001]);
  });

  it("a store name that DOES name its own variant still narrows to one, not zero", () => {
    // Synthetic, but exercises the mechanism directly: decide()'s own mutual-distinction rule
    // should already reject "Energy" against a store item that says "Deep Clean", leaving
    // exactly one candidate BEFORE the fan-out rule ever has to choose between two.
    const candidates = [
      cand("Nivea Men Deep Clean 500ml", 1, "Nivea"),
      cand("Nivea Men Energy 500ml", 2, "Nivea"),
      cand("Nivea Men Sensitive 500ml", 3, "Nivea"),
    ];
    const r = resolveFlyerFanout({ name: "Nivea Men Deep Clean 500ml", brand: "Nivea", ean: null, unit: "l", unitSize: 0.5 }, candidates, "grocery");
    expect(r.refusedFanout).toBe(false);
    expect(r.confirmed).toEqual([1]);
  });

  it("zero candidates is not a fan-out — there is nothing to arbitrate", () => {
    const r = resolveFlyerFanout({ name: "Ceva ce nu există", brand: null, ean: null, unit: "buc", unitSize: 1 }, [], "grocery");
    expect(r.refusedFanout).toBe(false);
    expect(r.confirmed.length).toBe(0);
  });
});
