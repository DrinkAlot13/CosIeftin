// ── THE GOLDEN SET, EVALUATED ONCE. Imported by the test AND by the baseline generator.
//
// Extracted so the two cannot disagree. A generator that recomputed the verdicts would be a
// second implementation of "did this pair match", and CLAUDE.md has three worked examples of
// what a restated concept does: it goes stale silently and keeps answering.
import { PAIRS, type Pair } from "./pairs";
import { matchDecision } from "../../src/lib/scrape-util";

export type Row = {
  pair: Pair;
  expected: boolean;
  actual: boolean;
  pass: boolean;
  score: number;
  reason: string;
};

/**
 * A pair's identity, stable across reordering and across pairs being added.
 *
 * This is what makes the lock denominator-proof: the baseline records WHICH pairs fail, not
 * how many. Adding a hard new pair cannot mask an old one starting to fail, and cannot turn
 * the build red on its own either — the two events stay distinguishable.
 */
export const pairKey = (p: Pair): string => `${p.section}|${p.category}|${p.a.name}|${p.b.name}`;

export const RESULTS: Row[] = PAIRS.map((p) => {
  const d = matchDecision(
    { name: p.a.name, brand: p.a.brand, unit: p.a.unit, unitSize: p.a.unitSize, ean: p.a.ean },
    { name: p.b.name, brand: p.b.brand, unit: p.b.unit, unitSize: p.b.unitSize, ean: p.b.ean },
    p.section,
  );
  const expected = p.label === "SHOULD_MATCH";
  return { pair: p, expected, actual: d.ok, pass: d.ok === expected, score: d.score, reason: d.reason };
});

export function tally(rows: Row[]) {
  const total = rows.length;
  const passed = rows.filter((r) => r.pass).length;
  // a FALSE MATCH (matched when it shouldn't) is the dangerous direction — it publishes
  // one product's price on another. A missed match only costs a comparison.
  const falseMatch = rows.filter((r) => !r.expected && r.actual).length;
  const falseMiss = rows.filter((r) => r.expected && !r.actual).length;
  return { total, passed, rate: total ? passed / total : 0, falseMatch, falseMiss };
}

export function groupBy<K extends string>(rows: Row[], key: (r: Row) => K): Map<K, Row[]> {
  const m = new Map<K, Row[]>();
  for (const r of rows) {
    const k = key(r);
    const a = m.get(k) ?? [];
    a.push(r);
    m.set(k, a);
  }
  return m;
}

/** The shape of `tests/golden/baseline.json`. */
export type GoldenBaseline = {
  recordedAt: string;
  total: number;
  passed: number;
  rate: number;
  falseMatch: number;
  falseMiss: number;
  /** Every pair that failed when the baseline was recorded, by `pairKey`. */
  knownFailures: string[];
};
