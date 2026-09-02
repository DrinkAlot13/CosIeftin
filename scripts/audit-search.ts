// ── SCOPE: DATA INTEGRITY ─────────────────────────────────────────────────────
// Counts EVERY row, shown or not — search quality.
// That is deliberate and is the opposite of the user-facing audits: a withheld row is
// still data, and a corruption hiding inside one is still a corruption. Do not add a
// visibility filter here.
// Run the 40-query search fixture against the LIVE catalog and report.
//
// The test suite runs the same queries against a frozen 1,028-name sample, which is what makes
// it fast and deterministic. This runs them against everything, which is what makes it true:
// a ranker that is perfect on a sample and drowns in 22,000 real products has not been tested.
//
// Read-only. Also reports the cost of each query, because search currently loads the whole
// grocery catalog into memory before scoring it.
//
// Run: npm run audit:search

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

async function main(): Promise<void> {
  const t0 = Date.now();
  const catalog = await prisma.product.findMany({
    where: { section: "grocery", offers: { some: { isStale: false, merchant: { active: true } } } },
    select: { name: true, brand: true },
  });
  const loadMs = Date.now() - t0;

  console.log(`\n  catalog: ${catalog.length} live grocery products (loaded in ${loadMs} ms)\n`);
  console.log(`  ${pad("query", 26)}${pad("hits", 7)}${pad("ms", 6)}  top result`);
  console.log("  " + "─".repeat(96));

  let pass = 0;
  const problems: string[] = [];
  let totalMs = 0;

  for (const c of SEARCH_CASES) {
    const t = Date.now();
    const rows = rankSearch(c.q, catalog).map((r) => r.item);
    const ms = Date.now() - t;
    totalMs += ms;

    const issues: string[] = [];
    if (c.expectEmpty && rows.length > 0) issues.push(`expected nothing, got ${rows.length}`);
    if (!c.expectEmpty) {
      for (const need of c.mustFind ?? []) {
        if (!rows.some((r) => norm(`${r.brand ?? ""} ${r.name}`).includes(norm(need)))) issues.push(`missing "${need}"`);
      }
      for (const avoid of c.mustNotFind ?? []) {
        if (rows.some((r) => norm(`${r.brand ?? ""} ${r.name}`).includes(norm(avoid)))) issues.push(`returned "${avoid}"`);
      }
      if (c.topMustContain && (rows.length === 0 || !norm(rows[0].name).includes(norm(c.topMustContain)))) {
        issues.push(`top is "${rows[0]?.name?.slice(0, 40) ?? "(nothing)"}"`);
      }
    }

    if (issues.length === 0) pass++;
    else problems.push(`  "${c.q}" — ${issues.join("; ")}`);

    console.log(
      `  ${pad(c.q || "(empty)", 26)}${pad(String(rows.length), 7)}${pad(String(ms), 6)}  ` +
      (rows[0]?.name.slice(0, 52) ?? "—") + (issues.length ? "   ⚠" : ""),
    );
  }

  console.log("\n  " + "─".repeat(96));
  console.log(`  ${pass}/${SEARCH_CASES.length} queries meet their expectations`);
  if (problems.length) {
    console.log("\n  NOT MET:");
    for (const p of problems) console.log(p);
  }

  const avg = Math.round(totalMs / SEARCH_CASES.length);
  console.log(`\n  scoring: ${avg} ms average per query over ${catalog.length} products`);
  console.log(`  catalog load: ${loadMs} ms — PAID ON EVERY SEARCH REQUEST.`);
  console.log(
    "  Search reads the whole grocery catalog per query and scores it in Node. That is fine at\n" +
    "  this size and will not survive traffic; the Postgres cutover (pg_trgm + unaccent) is\n" +
    "  where this stops being a full scan. Reported, not fixed — see the morning report.\n",
  );

  await prisma.$disconnect();
  if (pass < SEARCH_CASES.length) process.exit(1);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
