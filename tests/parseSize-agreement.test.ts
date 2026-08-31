// DRIFT GUARD: parseSize (old) vs parseQuantity (new) on 50 REAL catalog product names.
//
// Status when this was written: `parseSize` in ingest-core.ts is still LIVE — it is what
// `scrape-util.ts` uses to size every scraped item, and what `scrape-auchan.ts` (the
// catalog master) uses. `parseQuantity` is the intended replacement but the matcher has
// NOT been cut over yet.
//
// Two size parsers running side by side is exactly how a subtle divergence ships: the
// matcher sizes a product one way, a new feature sizes it another, and products stop
// matching for reasons nobody can see. So until the cutover, they must agree — on real
// names, not invented ones.
//
// (Note: `ingestItemsForMerchant`, the other export of ingest-core.ts, is already dead
// code — nothing imports it. Only `parseSize` keeps that module alive.)
//
// Refresh the fixture with a fresh catalog sample if product names change materially.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "./run";
import { parseSize } from "../src/lib/ingest-core";
import { parseQuantity } from "../src/lib/units/parseQuantity";

const NAMES: string[] = JSON.parse(
  readFileSync(join(process.cwd(), "tests", "fixtures", "catalog", "product-names-50.json"), "utf8"),
);

/**
 * The two parsers use different scales on purpose:
 *   parseSize      → { unit: "kg" | "l" | "buc", unitSize }   (BASE units)
 *   parseQuantity  → { unit: "G"  | "ML" | "BUC", value }     (MILLI units)
 * Convert the old shape onto the new scale so a comparison is meaningful.
 */
function canonicalise(s: { unit: string; unitSize: number } | null): { unit: string; value: number } | null {
  if (!s) return null;
  const round = (n: number) => Math.round(n * 1000) / 1000;
  if (s.unit === "kg") return { unit: "G", value: round(s.unitSize * 1000) };
  if (s.unit === "l") return { unit: "ML", value: round(s.unitSize * 1000) };
  return { unit: "BUC", value: round(s.unitSize) };
}

describe("parseSize / parseQuantity agreement on real catalog names", () => {
  it("the fixture holds 50 real product names", () => expect(NAMES.length).toBe(50));

  it("both parsers agree on every one of the 50", () => {
    const disagreements: string[] = [];
    for (const name of NAMES) {
      const oldSide = canonicalise(parseSize(name));
      const q = parseQuantity(name);
      const newSide = q ? { unit: q.unit, value: q.value } : null;
      if (JSON.stringify(oldSide) !== JSON.stringify(newSide)) {
        disagreements.push(`"${name}" → parseSize=${JSON.stringify(oldSide)} parseQuantity=${JSON.stringify(newSide)}`);
      }
    }
    if (disagreements.length) {
      throw new Error(
        `${disagreements.length}/${NAMES.length} names disagree — the two size parsers have drifted:\n  ` +
          disagreements.slice(0, 10).join("\n  "),
      );
    }
    expect(disagreements.length).toBe(0);
  });

  // Multipacks are the case most likely to diverge, because the OLD parser multiplies into
  // a single total while the new one also retains the pack shape. The TOTAL must still match.
  it("multipacks: totals agree even though only parseQuantity keeps the pack shape", () => {
    for (const name of ["Apă minerală 6x1.5L", "Bere 4 x 330 ml", "Kefir Muller, 2 x 500 g"]) {
      const oldSide = canonicalise(parseSize(name));
      const q = parseQuantity(name);
      expect(oldSide?.value).toBe(q?.value);
      expect(oldSide?.unit).toBe(q?.unit);
    }
    // …and only the new parser knows it was a multipack
    expect(parseQuantity("Apă minerală 6x1.5L")!.packCount).toBe(6);
  });

  it("both return null for a name that declares no size", () => {
    expect(parseSize("Pâine feliată")).toBe(null);
    expect(parseQuantity("Pâine feliată")).toBe(null);
  });
});
