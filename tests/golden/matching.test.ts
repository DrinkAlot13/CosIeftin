// GOLDEN SET RUNNER — the number that decides whether a matcher change is safe.
//
// It asserts THREE things:
//   1. the two known production regressions never come back (hard, named, unconditional);
//   2. FALSE MATCHES never rise above the recorded baseline — the direction that publishes
//      one product's price on another;
//   3. NO PAIR THAT PASSED AT THE BASELINE STARTS FAILING.
//
// (3) is recorded as a SET of pair keys rather than an aggregate rate, and that is deliberate.
// CLAUDE.md said "must not lower the pass rate recorded in BASELINE.md (currently 97.8%)" and
// nothing enforced it, so when 17 harder pairs were added across two commits the rate moved to
// 95.0% and the record went stale in silence — exactly the failure this project has catalogued
// three times over. A rate cannot distinguish "the matcher got worse" from "the set got
// harder"; a set of pair keys can, and it cannot go stale without the build going red.
//
// New pairs are ALLOWED to fail. They are targets, and several were deliberately written
// before the fix they grade. What is not allowed is an old pair quietly joining them.
//
// To move the baseline: `npm run golden:baseline -- --write`, and say why in BASELINE.md.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "../run";
import { PAIRS } from "./pairs";
import { RESULTS, tally, groupBy, pairKey, type Row, type GoldenBaseline } from "./evaluate";

const BASELINE = JSON.parse(
  readFileSync(join(process.cwd(), "tests", "golden", "baseline.json"), "utf8"),
) as GoldenBaseline;

// ── print the report once, at import time, so it shows up in the test output ──────
const overall = tally(RESULTS);
const lines: string[] = [];
lines.push("");
lines.push("═".repeat(78));
lines.push(`  GOLDEN SET — ${overall.total} hand-labelled pairs`);
lines.push(`  PASS RATE: ${(overall.rate * 100).toFixed(1)}%  (${overall.passed}/${overall.total})`);
lines.push(`  false MATCHES (dangerous): ${overall.falseMatch}   false misses: ${overall.falseMiss}`);
lines.push("═".repeat(78));

lines.push("\n  BY SECTION");
lines.push("  " + "section".padEnd(12) + "pairs  pass   rate     falseMatch  falseMiss");
for (const [section, rows] of [...groupBy(RESULTS, (r) => r.pair.section)].sort()) {
  const t = tally(rows);
  lines.push(
    "  " + section.padEnd(12) + String(t.total).padStart(5) + String(t.passed).padStart(6) +
    `  ${(t.rate * 100).toFixed(1).padStart(5)}%` + String(t.falseMatch).padStart(12) + String(t.falseMiss).padStart(11),
  );
}

lines.push("\n  BY CATEGORY (the failure modes the fan-out audit proved)");
lines.push("  " + "category".padEnd(26) + "pairs  pass   rate     falseMatch");
for (const [cat, rows] of [...groupBy(RESULTS, (r) => r.pair.category)].sort((a, b) => tally(a[1]).rate - tally(b[1]).rate)) {
  const t = tally(rows);
  const flag = t.falseMatch > 0 ? "  ⚠" : "";
  lines.push(
    "  " + cat.padEnd(26) + String(t.total).padStart(5) + String(t.passed).padStart(6) +
    `  ${(t.rate * 100).toFixed(1).padStart(5)}%` + String(t.falseMatch).padStart(12) + flag,
  );
}

const bad = RESULTS.filter((r) => !r.pass && !r.expected);
if (bad.length) {
  lines.push(`\n  FALSE MATCHES (${bad.length}) — these publish one product's price on another:`);
  for (const r of bad.slice(0, 25)) {
    lines.push(`    [${r.pair.category}] score=${r.score.toFixed(2)} ${r.reason}`);
    lines.push(`        A: ${r.pair.a.name.slice(0, 66)}`);
    lines.push(`        B: ${r.pair.b.name.slice(0, 66)}`);
  }
  if (bad.length > 25) lines.push(`    … and ${bad.length - 25} more`);
}
const missed = RESULTS.filter((r) => !r.pass && r.expected);
if (missed.length) {
  lines.push(`\n  MISSED MATCHES (${missed.length}) — a lost comparison, not a wrong price:`);
  for (const r of missed.slice(0, 15)) {
    lines.push(`    [${r.pair.category}] ${r.reason}  ${r.pair.a.name.slice(0, 48)}  ~/~  ${r.pair.b.name.slice(0, 48)}`);
  }
  if (missed.length > 15) lines.push(`    … and ${missed.length - 15} more`);
}
lines.push("");
console.log(lines.join("\n"));

// ── assertions ────────────────────────────────────────────────────────────────────
describe("golden set — structure", () => {
  it("holds at least 200 labelled pairs", () => expect(PAIRS.length >= 200).toBeTruthy());
  it("covers all five sections", () => {
    const secs = new Set(PAIRS.map((p) => p.section));
    for (const s of ["grocery", "alcohol", "dcneu", "cosmetice", "farmacie"]) expect(secs.has(s)).toBeTruthy();
  });
  it("contains both SHOULD_MATCH and SHOULD_NOT_MATCH", () => {
    expect(PAIRS.some((p) => p.label === "SHOULD_MATCH")).toBeTruthy();
    expect(PAIRS.some((p) => p.label === "SHOULD_NOT_MATCH")).toBeTruthy();
  });
});

// The two production regressions are hard assertions — they may never come back,
// regardless of what the aggregate rate does.
describe("golden set — the two known production regressions", () => {
  it("REGRESSION: the 15-lei Zarea Sânge de Taur backs no unrelated wine", () => {
    const rows = RESULTS.filter((r) => r.pair.note === "THE 64-way over-match regression");
    expect(rows.length >= 12).toBeTruthy();
    const leaks = rows.filter((r) => r.actual);
    if (leaks.length) throw new Error(`${leaks.length} unrelated wines matched Zarea: ${leaks.map((l) => l.pair.b.name).join(" | ")}`);
    expect(leaks.length).toBe(0);
  });

  it("REGRESSION: a generic 'Dom' bottle is not Dom Pérignon", () => {
    const rows = RESULTS.filter((r) => r.pair.note === "THE 32,49 lei regression" || r.pair.b.name.includes("Dom Bogdan"));
    expect(rows.length >= 4).toBeTruthy();
    const leaks = rows.filter((r) => r.actual);
    expect(leaks.length).toBe(0);
  });

  it("REGRESSION: Dom Pérignon Brut and Rosé stay distinct", () => {
    const r = RESULTS.find((x) => x.pair.a.name === "Dom Perignon Brut 0.75L" && x.pair.b.name === "Dom Perignon Rose 0.75L")!;
    expect(r.actual).toBeFalsy();
  });

  it("size guards hold: no pair with differing units or >6% size gap matches", () => {
    const bad = RESULTS.filter((r) => r.actual && (r.pair.a.unit !== r.pair.b.unit ||
      Math.abs(r.pair.a.unitSize - r.pair.b.unitSize) > r.pair.a.unitSize * 0.06 + 1e-9));
    if (bad.length) throw new Error(`size guard leaked on: ${bad.map((b) => `${b.pair.a.name} ~ ${b.pair.b.name}`).join(" | ")}`);
    expect(bad.length).toBe(0);
  });
});

// ── THE LOCK. Until now this was a sentence in CLAUDE.md, and a sentence enforces nothing.
describe("golden set — the baseline lock", () => {
  // The dangerous direction, asserted on its own. A false match publishes one product's price
  // on another; a false miss only costs a comparison. They are not interchangeable, so a fall
  // in one may never pay for a rise in the other.
  it("false matches never rise above the baseline", () => {
    if (overall.falseMatch > BASELINE.falseMatch) {
      const names = RESULTS.filter((r) => !r.pass && !r.expected)
        .map((r) => `${r.pair.a.name} ~ ${r.pair.b.name}`)
        .join("\n    ");
      throw new Error(
        `false matches ${BASELINE.falseMatch} → ${overall.falseMatch} (recorded ${BASELINE.recordedAt}):\n    ${names}`,
      );
    }
    expect(overall.falseMatch <= BASELINE.falseMatch).toBeTruthy();
  });

  // The regression test proper. Immune to the denominator: adding a hard pair cannot mask an
  // old pair starting to fail, because the baseline names the failures instead of counting them.
  it("no pair that passed at the baseline now fails", () => {
    const known = new Set(BASELINE.knownFailures);
    const regressed = RESULTS.filter((r) => !r.pass && !known.has(pairKey(r.pair)));
    if (regressed.length) {
      const detail = regressed
        .map((r) => `[${r.pair.category}] ${r.expected ? "MISSED" : "FALSE MATCH"} score=${r.score.toFixed(2)} ${r.reason}\n      ${r.pair.a.name}\n      ${r.pair.b.name}`)
        .join("\n    ");
      throw new Error(
        `${regressed.length} pair(s) passed at the ${BASELINE.recordedAt} baseline and fail now.\n` +
          `    If these are NEW pairs, record them: npm run golden:baseline -- --write\n` +
          `    If they are not, this is a matcher regression.\n    ${detail}`,
      );
    }
    expect(regressed.length).toBe(0);
  });

  // A baseline listing a pair that no longer exists is a baseline nobody has re-recorded, and
  // it would silently excuse a real regression on a renamed pair. Same rule as the concepts
  // register: a stale record is a failure, not a pass.
  it("the baseline names no pair that has since been removed or renamed", () => {
    const live = new Set(PAIRS.map(pairKey));
    const orphans = BASELINE.knownFailures.filter((k) => !live.has(k));
    if (orphans.length) {
      throw new Error(
        `baseline.json lists ${orphans.length} pair(s) that no longer exist. Re-record it:\n    ` +
          orphans.join("\n    "),
      );
    }
    expect(orphans.length).toBe(0);
  });
});

// Exported so a future tuning session can assert improvement rather than a fixed number.
export const GOLDEN_SUMMARY = {
  overall,
  bySection: Object.fromEntries([...groupBy(RESULTS, (r) => r.pair.section)].map(([k, v]) => [k, tally(v)])),
  byCategory: Object.fromEntries([...groupBy(RESULTS, (r) => r.pair.category)].map(([k, v]) => [k, tally(v)])),
};
