// The three-band tradeoff curve, on the golden set.
//
// AUTO_MATCH_THRESHOLD and REVIEW_THRESHOLD decide what gets published, what a human looks at,
// and what is thrown away. They are currently 0.62 and 0.42, and nothing recorded why.
//
// The two errors are NOT symmetric and the curve has to be read with that in mind:
//   • a false MATCH publishes one product's price on another — a wrong number, on a page, about
//     a named retailer;
//   • a false MISS costs a comparison — the shopper sees one shop instead of two.
// So a threshold that trades one false match for several false misses is a good trade, and the
// reverse is not. There is no single "best" number on this curve, which is exactly why the
// output is a curve and not a recommendation.
//
// Read-only, and it changes nothing: it reports what each setting WOULD do.
//
// Run: npm run audit:bands

import { PAIRS } from "../tests/golden/pairs";
import { matchDecision } from "../src/lib/scrape-util";

const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const lpad = (s: string | number, n: number): string => String(s).padStart(n);

type Row = {
  auto: number;
  falseMatch: number;
  falseMiss: number;
  toReview: number;
  correctAuto: number;
};

function evaluate(autoAt: number, reviewAt: number): Row {
  const row: Row = { auto: 0, falseMatch: 0, falseMiss: 0, toReview: 0, correctAuto: 0 };
  for (const p of PAIRS) {
    const shouldMatch = p.label === "SHOULD_MATCH";
    const d = matchDecision(
      { name: p.a.name, brand: p.a.brand ?? null, unit: p.a.unit, unitSize: p.a.unitSize, ean: p.a.ean ?? null },
      { name: p.b.name, brand: p.b.brand ?? null, unit: p.b.unit, unitSize: p.b.unitSize, ean: p.b.ean ?? null },
      p.section,
    );
    // Re-band by the candidate thresholds rather than by the shipped ones.
    const band = d.score >= autoAt ? "AUTO" : d.score >= reviewAt ? "REVIEW" : "REJECT";
    // A decision the matcher already rejected outright stays rejected whatever the threshold:
    // the size and mutual-distinction guards are structural, not score-based.
    const effective = d.ok ? band : "REJECT";

    if (effective === "AUTO") {
      row.auto++;
      if (shouldMatch) row.correctAuto++;
      else row.falseMatch++;
    } else if (effective === "REVIEW") {
      row.toReview++;
      if (shouldMatch) row.falseMiss++; // not published without a human
    } else if (shouldMatch) {
      row.falseMiss++;
    }
  }
  return row;
}

function main(): void {
  const shouldMatch = PAIRS.filter((p) => p.label === "SHOULD_MATCH").length;
  console.log(`\n  golden set: ${PAIRS.length} pairs (${shouldMatch} should match, ${PAIRS.length - shouldMatch} should not)\n`);

  console.log("  AUTO_MATCH_THRESHOLD SWEEP  (review fixed at 0.42)");
  console.log(`  ${pad("auto", 8)}${lpad("published", 11)}${lpad("FALSE MATCH", 13)}${lpad("false miss", 12)}${lpad("to review", 11)}`);
  console.log("  " + "─".repeat(55));
  for (const auto of [0.50, 0.54, 0.58, 0.62, 0.66, 0.70, 0.74, 0.78]) {
    const r = evaluate(auto, 0.42);
    const mark = Math.abs(auto - 0.62) < 1e-9 ? "  <- shipped" : "";
    console.log(
      `  ${pad(auto.toFixed(2), 8)}${lpad(r.auto, 11)}${lpad(r.falseMatch, 13)}${lpad(r.falseMiss, 12)}${lpad(r.toReview, 11)}${mark}`,
    );
  }

  console.log("\n  REVIEW_THRESHOLD SWEEP  (auto fixed at 0.62)");
  console.log(`  ${pad("review", 8)}${lpad("published", 11)}${lpad("FALSE MATCH", 13)}${lpad("false miss", 12)}${lpad("to review", 11)}`);
  console.log("  " + "─".repeat(55));
  for (const rev of [0.30, 0.34, 0.38, 0.42, 0.46, 0.50, 0.54]) {
    const r = evaluate(0.62, rev);
    const mark = Math.abs(rev - 0.42) < 1e-9 ? "  <- shipped" : "";
    console.log(
      `  ${pad(rev.toFixed(2), 8)}${lpad(r.auto, 11)}${lpad(r.falseMatch, 13)}${lpad(r.falseMiss, 12)}${lpad(r.toReview, 11)}${mark}`,
    );
  }

  console.log(
    "\n  published   = auto-matched and shown to a shopper\n" +
    "  FALSE MATCH = one product's price published on another. The expensive error.\n" +
    "  false miss  = a comparison lost. Cheap by comparison.\n" +
    "  to review   = held for a human instead of published.\n",
  );

  const shipped = evaluate(0.62, 0.42);
  console.log(`  At the shipped 0.62 / 0.42: ${shipped.falseMatch} false match(es), ${shipped.falseMiss} false miss(es), ${shipped.toReview} to review.`);
  console.log("  These values are PROVISIONAL. The curve above is the evidence for changing them;");
  console.log("  a number picked because it looked good on one run is not.\n");
}

main();
