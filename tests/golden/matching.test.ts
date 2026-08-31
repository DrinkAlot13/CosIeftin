// GOLDEN SET RUNNER — the number that decides whether a matcher change is safe.
//
// This file does NOT assert a fixed pass rate. It asserts the two known production
// regressions never come back, and it PRINTS the full breakdown by section and category
// so a before/after comparison is possible across a matcher change.
//
// Baseline is recorded in tests/golden/BASELINE.md. Update it deliberately, with the
// commit that moved the number.
import { describe, it, expect } from "../run";
import { PAIRS, type Pair } from "./pairs";
import { matchDecision } from "../../src/lib/scrape-util";

type Row = { pair: Pair; expected: boolean; actual: boolean; pass: boolean; score: number; reason: string };

const RESULTS: Row[] = PAIRS.map((p) => {
  const d = matchDecision(
    { name: p.a.name, brand: p.a.brand, unit: p.a.unit, unitSize: p.a.unitSize, ean: p.a.ean },
    { name: p.b.name, brand: p.b.brand, unit: p.b.unit, unitSize: p.b.unitSize, ean: p.b.ean },
    p.section,
  );
  const expected = p.label === "SHOULD_MATCH";
  return { pair: p, expected, actual: d.ok, pass: d.ok === expected, score: d.score, reason: d.reason };
});

function tally(rows: Row[]) {
  const total = rows.length;
  const passed = rows.filter((r) => r.pass).length;
  // a FALSE MATCH (matched when it shouldn't) is the dangerous direction — it publishes
  // one product's price on another. A missed match only costs a comparison.
  const falseMatch = rows.filter((r) => !r.expected && r.actual).length;
  const falseMiss = rows.filter((r) => r.expected && !r.actual).length;
  return { total, passed, rate: total ? passed / total : 0, falseMatch, falseMiss };
}

function groupBy<K extends string>(rows: Row[], key: (r: Row) => K): Map<K, Row[]> {
  const m = new Map<K, Row[]>();
  for (const r of rows) {
    const k = key(r);
    const a = m.get(k) ?? [];
    a.push(r);
    m.set(k, a);
  }
  return m;
}

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

// Exported so a future tuning session can assert improvement rather than a fixed number.
export const GOLDEN_SUMMARY = {
  overall,
  bySection: Object.fromEntries([...groupBy(RESULTS, (r) => r.pair.section)].map(([k, v]) => [k, tally(v)])),
  byCategory: Object.fromEntries([...groupBy(RESULTS, (r) => r.pair.category)].map(([k, v]) => [k, tally(v)])),
};
