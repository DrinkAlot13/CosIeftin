// ONE size parser, and a frozen reading of 50 real catalog names.
//
// This file used to compare `parseSize` against `parseQuantity` and demand they agree. As of
// Phase 1a they cannot disagree: `parseSize` is a thin adapter over `parseQuantity`, kept only
// because the Product schema stores kg/l/buc rather than the canonical G/ML/BUC.
//
// That makes the old comparison tautological — a test that can only ever pass, which is worse
// than no test because it looks like protection. So it is replaced by the two things that
// still have teeth:
//
//   1. `parseSize` must stay an adapter. The two implementations quietly disagreed on 611 of
//      34,263 catalog names (1.78%) before they were merged — every promotional pack, every
//      "24 plicuri x 15 g" coffee box, and "Albrau,0.5 l", where the old regex captured ",0.5",
//      parseFloat read it as 0, and the product got a unitSize of ZERO. Nothing announced any
//      of it. If a second implementation ever grows back, this test fails.
//   2. A frozen reading of 50 REAL names. Any change to the shared parser now shows up as a
//      diff against recorded values rather than being discovered in production.
//
// Refresh the fixture only deliberately, and read the diff before you do.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "./run";
import { parseSize } from "../src/lib/ingest-core";
import { parseQuantity, type Quantity } from "../src/lib/units/parseQuantity";

const DIR = join(process.cwd(), "tests", "fixtures", "catalog");
const NAMES: string[] = JSON.parse(readFileSync(join(DIR, "product-names-50.json"), "utf8"));
const EXPECTED: Record<string, Quantity | null> = JSON.parse(
  readFileSync(join(DIR, "product-names-50.parsed.json"), "utf8"),
);

describe("one size parser — parseSize is an adapter, not a second implementation", () => {
  it("ingest-core declares no size regexes of its own", () => {
    const src = readFileSync(join(process.cwd(), "src", "lib", "ingest-core.ts"), "utf8");
    // The tell-tale of a re-grown parser: a unit-word alternation inside this module.
    const body = src.slice(src.indexOf("export function parseSize"));
    const decl = body.slice(0, body.indexOf("\n}"));
    expect(/ml\s*\|\s*cl|kg\s*\|\s*gr|\\d\+/.test(decl)).toBeFalsy();
    expect(decl.includes("parseQuantity(")).toBeTruthy();
  });

  it("delegates every reading, including the ones the old parser got wrong", () => {
    // Promotional pack: the old parser read one 125 g pot out of an eight-pack.
    expect(parseSize("Iaurt natur Activia, (7+1) x 125 g")).toEqual({ unit: "kg", unitSize: 1 });
    // Sachet box: the old parser read 15 g and discarded the count.
    expect(parseSize("Cafea Nescafe 3 in 1 Mild, 24 plicuri x 15 g")).toEqual({ unit: "kg", unitSize: 0.36 });
    // The zero-unitSize bug: a comma glued to the number parsed as 0.
    expect(parseSize("Bere fara alcool Albrau,0.5 l")).toEqual({ unit: "l", unitSize: 0.5 });
  });

  it("never returns a zero or negative unitSize", () => {
    for (const name of NAMES) {
      const s = parseSize(name);
      if (s) expect(s.unitSize > 0).toBeTruthy();
    }
  });

  it("the kg/l/buc adapter is exactly the canonical value over 1000 (or the count)", () => {
    for (const name of NAMES) {
      const q = parseQuantity(name);
      const s = parseSize(name);
      if (!q) { expect(s).toBe(null); continue; }
      const want = q.unit === "BUC"
        ? { unit: "buc", unitSize: q.value }
        : { unit: q.unit === "G" ? "kg" : "l", unitSize: q.value / 1000 };
      expect(s).toEqual(want);
    }
  });
});

describe("frozen reading of 50 real catalog names", () => {
  it("the fixture holds 50 real product names", () => expect(NAMES.length).toBe(50));

  it("every name parses exactly as recorded", () => {
    const drift: string[] = [];
    for (const name of NAMES) {
      const got = parseQuantity(name);
      const want = EXPECTED[name] ?? null;
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        drift.push(`"${name}"\n      recorded: ${JSON.stringify(want)}\n      now:      ${JSON.stringify(got)}`);
      }
    }
    if (drift.length) {
      throw new Error(
        `${drift.length}/${NAMES.length} names now parse differently than recorded.\n` +
          `  If the change is intended, regenerate product-names-50.parsed.json — but read this first:\n    ` +
          drift.slice(0, 8).join("\n    "),
      );
    }
    expect(drift.length).toBe(0);
  });

  it("multipacks keep their pack shape, not just their total", () => {
    const q = parseQuantity("Apă minerală 6x1.5L")!;
    expect(q.value).toBe(9000); expect(q.packCount).toBe(6); expect(q.packSize).toBe(1500);
    expect(parseSize("Apă minerală 6x1.5L")).toEqual({ unit: "l", unitSize: 9 });
  });

  it("both return null for a name that declares no size", () => {
    expect(parseSize("Pâine feliată")).toBe(null);
    expect(parseQuantity("Pâine feliată")).toBe(null);
  });
});
