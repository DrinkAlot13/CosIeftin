// The history gate flags. It never substitutes.
//
// THE EVIDENCE, all from one day:
//   Auchan 1905     kept 28,14, refused 12,00. Independently re-scraped: 11,69.
//   Kaufland        kept 37,90, refused 6,89.  Kaufland's own JSON: price 6.89, unit 100g.
//   Mega Image 10156 kept 5,29, refused 23,95 for a "5+1 x 0.33 l" six-pack.
//   30 August       1,652 of 1,653 corrected prices reproduce from their own source string.
//
// Four for four, the refused value was the better one. The reason generalizes: a gate
// anchored on stored history assumes history is more trustworthy than the new observation,
// and that assumption is exactly inverted during the period when parsers are being corrected
// — which has been every day of this project. History-anchoring defends stale data against
// fresh data.
//
// 135 stored prices in this catalog were kept over a refused one. 106 are DCNeu rows from the
// fabricated-price era, holding values four to six times too low, defended against their own
// correction: a 6-pack of Protex soap at 2,74 against a real 21,24.
//
// It is NOT uniformly wrong. Glenfiddich 21 kept 899,99 over a mis-parsed 152,42 and there
// the gate was right. It simply cannot tell a correction from a parse error — so it must not
// be the thing that decides. It flags, the offer is withheld from display and queued, and
// what decides is an oracle where one exists or unit-price plausibility where one does not.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "./run";

const SRC = readFileSync(join(process.cwd(), "src", "lib", "scrape-util.ts"), "utf8");

/**
 * The source with comments stripped.
 *
 * The first version of this test searched the whole file and failed on its OWN explanatory
 * comment — the one describing the line that was removed. A test that cannot tell code from
 * prose about code will either be deleted or will make everyone delete the prose, and the
 * prose is why the next person will not put the line back.
 */
const CODE = SRC
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((l) => !l.trim().startsWith("//"))
  .join("\n");

describe("the price gate flags and does not substitute", () => {
  it("never assigns the previous price over the fresh one", () => {
    // `writePrice = prev` is the whole bug in one line. Checked against CODE, so the
    // comment that explains its removal does not trip it.
    expect(/writePrice\s*=\s*prev/.test(CODE)).toBe(false);
  });

  it("writePrice is a const bound to the observed price", () => {
    // A `let` invites a future substitution to creep back in.
    expect(CODE).toContain("const writePrice = o.price;");
  });

  it("still flags a large move", () => {
    // Flagging is not softened - a flagged offer is withheld from display and queued.
    expect(CODE).toContain("if (jump || outlier)");
    expect(CODE).toContain("flagged = true");
  });

  it("records the move with nothing marked as refused", () => {
    // rejectedPriceBani 0 is the honest encoding: we refused nothing, we wrote the fresh
    // value. audit:kept-over-refused keys on a NON-zero rejected value, so it keeps
    // reporting the historical substitutions and correctly reports nothing new.
    const at = CODE.indexOf("await recordRefusal({");
    expect(at > 0).toBe(true);
    expect(CODE.slice(at, at + 400)).toContain("rejectedPriceBani: 0");
  });

  it("provenance cannot diverge from the price, and the guard stays", () => {
    // With no substitution the flagged-provenance bug cannot recur - but the guard remains
    // so that a future gate which DOES substitute cannot silently corrupt it again.
    expect(CODE).toContain("priceWasRefused");
  });

  it("the file header no longer documents the old behaviour", () => {
    // A comment that describes behaviour the code no longer has is how the next person
    // reintroduces it.
    expect(SRC.includes("the old price is kept rather than written")).toBe(false);
  });
});
