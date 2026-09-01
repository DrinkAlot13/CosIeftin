// A rule that never fires is indistinguishable from a rule that is wrong.
//
// THE CASE THIS EXISTS FOR. `doseTokens()` carries the regex that compares garment and egg
// size codes — the exact comparison CLAUDE.md demands be made explicitly, because a
// single-character size is dropped by the overlap scorer as unit noise. That regex had a
// literal `s` where a whitespace class belonged and a 0x08 backspace where a word boundary
// belonged, so it was UNSATISFIABLE. It was present, it was referenced, it ran on every
// comparison, and it returned nothing, for as long as it existed.
//
// The cost was visible the whole time as the golden set's false match on eggs, and it was
// attributed to matcher tuning. Nothing in the system could say "this rule never runs".
//
// Now every run counts how often each rule fired and prints the table. This test keeps the
// enumeration honest: a new rule cannot be added to `decide()` without appearing in
// DECISION_REASONS, so the coverage table can never quietly stop covering something.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "./run";
import { DECISION_REASONS, DecisionCoverage, decide, prep } from "../src/lib/scrape-util";

const SRC = readFileSync(join(process.cwd(), "src", "lib", "scrape-util.ts"), "utf8");

/** Every `reason: "..."` literal inside the body of decide(). */
function reasonsInDecide(): string[] {
  const start = SRC.indexOf("export function decide(");
  expect(start > 0).toBe(true);
  // decide() ends at the next top-level `export ` after it.
  const after = SRC.indexOf("\nexport ", start + 10);
  const body = SRC.slice(start, after > 0 ? after : undefined);
  const out = new Set<string>();
  for (const m of body.matchAll(/reason:\s*"([a-z+-]+)"/g)) out.add(m[1]);
  // the accept path is a ternary over two literals
  for (const m of body.matchAll(/reason:\s*branded\s*\?\s*"([a-z+-]+)"\s*:\s*"([a-z+-]+)"/g)) {
    out.add(m[1]);
    out.add(m[2]);
  }
  return [...out].sort();
}

describe("decision coverage — the enumeration cannot fall behind the code", () => {
  it("DECISION_REASONS lists every reason decide() can return", () => {
    const inCode = reasonsInDecide();
    const declared: string[] = [...DECISION_REASONS].sort();
    const missing = inCode.filter((r) => !declared.includes(r));
    expect(missing).toEqual([]);
  });

  it("DECISION_REASONS lists nothing decide() cannot return", () => {
    // A stale entry would sit at zero forever and train everyone to ignore the warning.
    const inCode = reasonsInDecide();
    const extra = [...DECISION_REASONS].filter((r) => !inCode.includes(r));
    expect(extra).toEqual([]);
  });
});

describe("decision coverage — the counter", () => {
  const cat = (n: string) => prep(n, null, null);
  const size = (u: string, v: number) => ({ unit: u, unitSize: v });

  it("counts a rule when it fires", () => {
    const c = new DecisionCoverage();
    // Different units → size-unit.
    c.record(decide(cat("Lapte 1 l"), size("l", 1), cat("Lapte 500 g"), size("g", 0.5), "grocery"));
    expect(c.silent.includes("size-unit")).toBe(false);
  });

  it("reports every rule that never fired", () => {
    const c = new DecisionCoverage();
    // Nothing recorded at all: every rule is silent, which is the alarm state.
    expect(c.silent.length).toBe(DECISION_REASONS.length);
  });

  it("a rule that CAN fire does fire — the doseTokens property, generalized", () => {
    // If dose comparison were unsatisfiable again, this decision would come back as
    // something other than dose-mismatch and the test would fail. That is the whole point:
    // a rule is proven reachable rather than assumed reachable.
    const d = decide(
      cat("Paracetamol 500 mg 20 comprimate"), size("buc", 20),
      cat("Paracetamol 1000 mg 20 comprimate"), size("buc", 20),
      "farmacie",
    );
    expect(d.reason).toBe("dose-mismatch");
    expect(d.ok).toBe(false);
  });

  it("the garment-size rule is reachable — the exact rule that was dead", () => {
    // "marimea L" vs "marimea M" must be a dose mismatch, not a match. This is the assertion
    // that would have failed for the entire life of the corrupted regex.
    const d = decide(
      cat("Oua de gaina marimea L, 10 bucati"), size("buc", 10),
      cat("Oua de gaina marimea M, 10 bucati"), size("buc", 10),
      "grocery",
    );
    expect(d.ok).toBe(false);
    expect(d.reason).toBe("dose-mismatch");
  });
});
