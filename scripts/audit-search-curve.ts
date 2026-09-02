// ── SCOPE: DATA INTEGRITY ─────────────────────────────────────────────────────
// Counts EVERY row, shown or not — search ranking.
// That is deliberate and is the opposite of the user-facing audits: a withheld row is
// still data, and a corruption hiding inside one is still a corruption. Do not add a
// visibility filter here.
// Search threshold: the tradeoff curve, not a number someone liked.
//
// The 40-query fixture passes at every setting below, because `mustFind` only asks whether the
// right product is present ANYWHERE. Against the real catalog that hides the actual defect:
// "lpate" returns 1,195 products topped by "Spinari si spate de pui", because levenshtein
// treats "lpate"→"spate" as a one-character typo and typo similarity ALONE clears the bar.
//
// So this sweeps the threshold and reports what each value costs and buys:
//   • top-1 accuracy — does the query's own expectation sit at position 1
//   • median result count — a five-letter query returning 1,200 rows is not a search result
//   • recall — is the right product still present at all
//
// Read-only. Prints a curve; changes nothing.
//
// Run: npm run audit:search-curve

import { PrismaClient } from "@prisma/client";
import { rankSearch } from "../src/lib/search/rank";
import { SEARCH_CASES } from "../tests/fixtures/search/queries";

const prisma = new PrismaClient();

const norm = (s: string): string =>
  s.toLowerCase()
    .split("ș").join("s").split("ş").join("s")
    .split("ț").join("t").split("ţ").join("t")
    .split("ă").join("a").split("â").join("a").split("î").join("i");

const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const lpad = (s: string | number, n: number): string => String(s).padStart(n);

async function main(): Promise<void> {
  const catalog = await prisma.product.findMany({
    where: { section: "grocery", offers: { some: { isStale: false, merchant: { active: true } } } },
    select: { name: true, brand: true },
  });
  console.log(`\n  ${catalog.length} live grocery products\n`);

  const answerable = SEARCH_CASES.filter((c) => !c.expectEmpty && (c.mustFind?.length || c.topMustContain));

  console.log("  THRESHOLD SWEEP");
  console.log(`  ${pad("thresh", 9)}${lpad("recall", 8)}${lpad("top-1", 8)}${lpad("median", 9)}${lpad("p90", 8)}${lpad("max", 9)}`);
  console.log("  " + "─".repeat(52));

  for (const th of [0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95, 1.05]) {
    let recall = 0;
    let top1 = 0;
    const counts: number[] = [];
    for (const c of answerable) {
      const rows = rankSearch(c.q, catalog).filter((r) => r.score >= th).map((r) => r.item);
      counts.push(rows.length);
      const want = c.topMustContain ?? c.mustFind![0];
      if (rows.some((r) => norm(`${r.brand ?? ""} ${r.name}`).includes(norm(want)))) recall++;
      if (rows.length > 0 && norm(`${rows[0].brand ?? ""} ${rows[0].name}`).includes(norm(want))) top1++;
    }
    counts.sort((a, b) => a - b);
    const median = counts[counts.length >> 1] ?? 0;
    const p90 = counts[Math.floor(counts.length * 0.9)] ?? 0;
    const max = counts[counts.length - 1] ?? 0;
    console.log(
      `  ${pad(th.toFixed(2), 9)}${lpad(`${recall}/${answerable.length}`, 8)}${lpad(`${top1}/${answerable.length}`, 8)}` +
      `${lpad(median, 9)}${lpad(p90, 8)}${lpad(max, 9)}`,
    );
  }

  console.log(
    "\n  recall  = the expected product is present somewhere\n" +
    "  top-1   = it is the FIRST result\n" +
    "  median/p90/max = results returned per query\n",
  );

  // The worst offenders at the current setting, which is what a curve alone will not show.
  console.log("  WORST TOP-1 MISSES AT THE CURRENT THRESHOLD");
  for (const c of answerable) {
    const rows = rankSearch(c.q, catalog).map((r) => r.item);
    const want = c.topMustContain ?? c.mustFind![0];
    if (rows.length && !norm(`${rows[0].brand ?? ""} ${rows[0].name}`).includes(norm(want))) {
      console.log(`    ${pad(c.q, 26)}${lpad(rows.length, 6)} hits · wanted "${want}" · got "${rows[0].name.slice(0, 44)}"`);
    }
  }
  console.log();
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
