// Tune the AUTO_MATCH / REVIEW / REJECT thresholds against the golden set.
//
// The question this answers: can the coverage lost to the mutual-distinction rule be moved
// into REVIEW instead of vanishing into REJECT, WITHOUT letting false matches back into the
// live band? Only AUTO_MATCH is shown to users, so precision is measured on that band alone.
//
// Run: npm run tune:bands
import { PAIRS } from "../tests/golden/pairs";
import { matchDecision } from "../src/lib/scrape-util";

type Row = { section: string; category: string; expected: boolean; band: string; score: number };

function evaluate(): Row[] {
  return PAIRS.map((p) => {
    const d = matchDecision(
      { name: p.a.name, brand: p.a.brand, unit: p.a.unit, unitSize: p.a.unitSize, ean: p.a.ean },
      { name: p.b.name, brand: p.b.brand, unit: p.b.unit, unitSize: p.b.unitSize, ean: p.b.ean },
      p.section,
    );
    return { section: p.section, category: p.category, expected: p.label === "SHOULD_MATCH", band: d.band, score: d.score };
  });
}

function stats(rows: Row[]) {
  const auto = rows.filter((r) => r.band === "AUTO_MATCH");
  const review = rows.filter((r) => r.band === "REVIEW");
  const reject = rows.filter((r) => r.band === "REJECT");
  const truePos = auto.filter((r) => r.expected).length;
  const falsePos = auto.filter((r) => !r.expected).length;
  const shouldMatch = rows.filter((r) => r.expected).length;
  // recall measured on the LIVE band only — a REVIEW pair is not yet a comparison
  const precision = auto.length ? truePos / auto.length : 1;
  const recall = shouldMatch ? truePos / shouldMatch : 1;
  // what the middle band rescues: true matches that would otherwise be rejected outright
  const rescued = review.filter((r) => r.expected).length;
  const reviewNoise = review.filter((r) => !r.expected).length;
  const lostForever = reject.filter((r) => r.expected).length;
  return { total: rows.length, auto: auto.length, review: review.length, reject: reject.length, truePos, falsePos, precision, recall, rescued, reviewNoise, lostForever };
}

function main() {
  const rows = evaluate();
  const overall = stats(rows);

  console.log("\n═══ THREE-BAND MATCHING, against the golden set ═══\n");
  console.log(`  pairs            ${overall.total}`);
  console.log(`  AUTO_MATCH       ${overall.auto}   (live)`);
  console.log(`  REVIEW           ${overall.review}   (persisted PENDING, not shown)`);
  console.log(`  REJECT           ${overall.reject}`);
  console.log("");
  console.log(`  precision (live) ${(overall.precision * 100).toFixed(1)}%   false matches: ${overall.falsePos}`);
  console.log(`  recall (live)    ${(overall.recall * 100).toFixed(1)}%`);
  console.log(`  rescued into REVIEW  ${overall.rescued}  (true matches that would otherwise be discarded)`);
  console.log(`  noise in REVIEW      ${overall.reviewNoise}  (a reviewer's cost)`);
  console.log(`  lost in REJECT       ${overall.lostForever}  (true matches gone for good)`);

  console.log("\n  BY SECTION");
  console.log("  " + "section".padEnd(12) + "auto  review  reject   prec(live)  falseMatch  rescued");
  for (const section of [...new Set(rows.map((r) => r.section))].sort()) {
    const s = stats(rows.filter((r) => r.section === section));
    console.log(
      "  " + section.padEnd(12) +
      String(s.auto).padStart(4) + String(s.review).padStart(8) + String(s.reject).padStart(8) +
      `   ${(s.precision * 100).toFixed(1).padStart(6)}%` + String(s.falsePos).padStart(12) + String(s.rescued).padStart(9),
    );
  }

  console.log("\n  BY CATEGORY");
  console.log("  " + "category".padEnd(26) + "auto  review  reject   falseMatch  rescued");
  for (const cat of [...new Set(rows.map((r) => r.category))].sort()) {
    const s = stats(rows.filter((r) => r.category === cat));
    console.log(
      "  " + cat.padEnd(26) +
      String(s.auto).padStart(4) + String(s.review).padStart(8) + String(s.reject).padStart(8) +
      String(s.falsePos).padStart(12) + String(s.rescued).padStart(9),
    );
  }

  console.log(
    overall.falsePos <= 2
      ? "\n  ✓ false matches within target (<= 2)"
      : `\n  ✗ false matches ${overall.falsePos} exceed the target of 2`,
  );
}

main();
