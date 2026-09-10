// ── RECORD THE GOLDEN SET'S CURRENT STATE AS THE BASELINE.
//
// `tests/golden/matching.test.ts` locks the matcher against `tests/golden/baseline.json`. This
// script is the ONLY way that file is written, and running it is a deliberate act: it says
// "the number moved, and I am accepting the new one".
//
// It prints the diff against the existing baseline first, so accepting a REGRESSION is never
// something that can happen by reflex. BASELINE.md is where you then write down why.
//
//   npm run golden:baseline           # show what would change
//   npm run golden:baseline -- --write

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { RESULTS, tally, pairKey, type GoldenBaseline } from "../tests/golden/evaluate";

const FILE = join(process.cwd(), "tests", "golden", "baseline.json");
const write = process.argv.includes("--write");

const overall = tally(RESULTS);
const failures = RESULTS.filter((r) => !r.pass).map((r) => pairKey(r.pair)).sort();

const next: GoldenBaseline = {
  recordedAt: new Date().toISOString().slice(0, 10),
  total: overall.total,
  passed: overall.passed,
  rate: Number(overall.rate.toFixed(4)),
  falseMatch: overall.falseMatch,
  falseMiss: overall.falseMiss,
  knownFailures: failures,
};

const prev: GoldenBaseline | null = existsSync(FILE)
  ? (JSON.parse(readFileSync(FILE, "utf8")) as GoldenBaseline)
  : null;

console.log("═".repeat(86));
console.log("  GOLDEN BASELINE");
console.log("═".repeat(86));
if (!prev) {
  console.log("  No baseline recorded yet. This run would create the first one.");
} else {
  const gone = prev.knownFailures.filter((k) => !next.knownFailures.includes(k));
  const added = next.knownFailures.filter((k) => !prev.knownFailures.includes(k));
  console.log(`  recorded ${prev.recordedAt}:  ${prev.passed}/${prev.total} = ${(prev.rate * 100).toFixed(1)}%  falseMatch ${prev.falseMatch}`);
  console.log(`  now:                  ${next.passed}/${next.total} = ${(next.rate * 100).toFixed(1)}%  falseMatch ${next.falseMatch}`);
  console.log();
  if (gone.length) {
    console.log(`  FIXED — these failed at the baseline and pass now (${gone.length}):`);
    for (const k of gone) console.log(`    + ${k}`);
  }
  if (added.length) {
    // This is the direction that matters. Every one of these is either a NEW pair that the
    // matcher does not yet handle, or a REGRESSION — and the two are not the same thing.
    console.log(`  NEWLY FAILING — a regression, or a newly-added pair (${added.length}):`);
    for (const k of added) console.log(`    - ${k}`);
  }
  if (!gone.length && !added.length) console.log("  No change in which pairs fail.");
  if (next.falseMatch > prev.falseMatch) {
    console.log();
    console.log(`  ⚠ FALSE MATCHES ROSE ${prev.falseMatch} → ${next.falseMatch}. That is the direction that`);
    console.log(`    publishes one product's price on another. Do not accept this without a reason.`);
  }
}
console.log("═".repeat(86));

if (write) {
  writeFileSync(FILE, JSON.stringify(next, null, 2) + "\n", "utf8");
  console.log(`  written: ${FILE}`);
  console.log(`  Now record WHY in tests/golden/BASELINE.md, in the same commit.`);
} else {
  console.log("  Dry run. Pass --write to record.");
}
