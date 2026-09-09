// ── SCOPE: DATA INTEGRITY ─────────────────────────────────────────────────────
// Runs the 40-query fixture against the LIVE catalog and grades every case.
//
// The unit test runs the same queries against a frozen 1,028-name sample, which is what makes
// it fast and deterministic. This runs them against everything, which is what makes it true: a
// ranker that is perfect on a sample and drowns in 22,000 real products has not been tested.
//
// Emits `--json <path>` so a BEFORE and an AFTER can be diffed rather than eyeballed.
//
// Read-only. Run: npm run audit:search-quality

import { PrismaClient } from "@prisma/client";
import { emitJson } from "../src/lib/audit-json";
import { normalizeRo } from "../src/lib/text/normalizeRo";
import { searchCatalog, type SearchOutcome } from "../src/lib/search/search";
import { SEARCH_CASES, type SearchCase } from "../tests/fixtures/search/queries";

const prisma = new PrismaClient();

const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const lp = (s: string | number, n: number): string => String(s).padStart(n);

type Row = { name: string; brand: string | null; categoryName: string | null; merchantCount: number };

const hay = (r: Row): string => normalizeRo(`${r.brand ?? ""} ${r.name}`);

/** Grade one case against what search actually returned. Returns the failures, empty when it passes. */
function grade(c: SearchCase, out: SearchOutcome<Row>): string[] {
  const bad: string[] = [];
  const rows = out.results.map((r) => r.item);

  if (c.expectEmpty) {
    if (out.kind !== "empty" || rows.length > 0) bad.push(`expected nothing, got ${rows.length} (${out.kind})`);
    return bad;
  }

  if (c.expectBrandMiss) {
    if (out.kind !== "brand-miss") {
      bad.push(`expected a brand-miss for "${c.expectBrandMiss}", got kind=${out.kind} with ${rows.length} results`);
    } else if (!out.missing.map((m) => normalizeRo(m)).includes(normalizeRo(c.expectBrandMiss))) {
      bad.push(`brand-miss reported [${out.missing.join(", ")}], expected "${c.expectBrandMiss}"`);
    }
    // Anything shown alongside a brand-miss is an ALTERNATIVE. It must never claim the brand.
    for (const r of rows) {
      if (hay(r).includes(normalizeRo(c.expectBrandMiss))) bad.push(`alternative falsely contains the missing brand: ${r.name}`);
    }
  } else if (out.kind === "brand-miss") {
    bad.push(`unexpected brand-miss on [${out.missing.join(", ")}]`);
  }

  for (const need of c.mustFind ?? []) {
    if (!rows.some((r) => hay(r).includes(normalizeRo(need)))) bad.push(`missing "${need}"`);
  }
  for (const no of c.mustNotFind ?? []) {
    const hit = rows.find((r) => hay(r).includes(normalizeRo(no)));
    if (hit) bad.push(`must not contain "${no}" but returned: ${hit.name}`);
  }
  if (c.topMustContain) {
    if (rows.length === 0) bad.push(`no results, expected top to contain "${c.topMustContain}"`);
    else if (!hay(rows[0]).includes(normalizeRo(c.topMustContain))) bad.push(`top is "${rows[0].name}", expected to contain "${c.topMustContain}"`);
  }
  // ── `mustNotFindInTop` WAS DECLARED BY THE FIXTURE AND CHECKED BY NOTHING HERE.
  //
  // `tests/search-quality.test.ts` applies it against a 1,444-name fixture catalog; this audit
  // runs the same cases against the LIVE catalog and silently skipped the assertion. So twenty
  // staple cases added to catch a real live defect all reported PASS while the audit's own
  // output, three lines above the verdict, showed `apa plata -> Aqua Carpatica Kids`.
  //
  // A check that can silently do nothing is worse than no check — the same rule `probe:links`
  // earned when it mis-parsed its arguments and printed a green tick over zero links.
  for (const no of c.topMustNotContain ?? []) {
    if (rows.length > 0 && hay(rows[0]).includes(normalizeRo(no))) {
      bad.push(`top result must not contain "${no}" — got "${rows[0].name}"`);
    }
  }
  for (const no of c.mustNotFindInTop ?? []) {
    const hit = rows.slice(0, 5).find((r) => hay(r).includes(normalizeRo(no)));
    if (hit) bad.push(`must not be in the top 5: "${no}" — got "${hit.name}"`);
  }
  if (c.brandRequired) {
    const wrong = rows.filter((r) => !hay(r).includes(normalizeRo(c.brandRequired!)));
    if (rows.length === 0) bad.push(`no results at all for brand "${c.brandRequired}"`);
    if (wrong.length) bad.push(`${wrong.length}/${rows.length} results are not ${c.brandRequired} (e.g. ${wrong[0].name})`);
  }
  return bad;
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const products = await prisma.product.findMany({
    where: { section: "grocery" },
    select: {
      name: true, brand: true,
      category: { select: { name: true } },
      offers: {
        where: { isStale: false, flagged: false, availability: "in stock", merchant: { active: true } },
        select: { merchantId: true },
      },
    },
  });
  // SHOWABLE ONLY. A stale, withheld or out-of-stock row is not a search result — CLAUDE.md's
  // display rules apply to the search box exactly as they apply to a listing page.
  const catalog: Row[] = products
    .filter((p) => p.offers.length > 0)
    .map((p) => ({
      name: p.name,
      brand: p.brand,
      categoryName: p.category?.name ?? null,
      merchantCount: new Set(p.offers.map((o) => o.merchantId)).size,
    }));
  const loadMs = Date.now() - t0;

  console.log(`\n════ SEARCH QUALITY — 40 queries against the live catalog ═══════════════════`);
  console.log(`  ${catalog.length} showable grocery products (loaded in ${loadMs} ms)\n`);
  console.log(`  ${pad("query", 26)}${pad("kind", 12)}${lp("hits", 6)}${lp("ms", 7)}  top result`);
  console.log("  " + "─".repeat(94));

  const results: { q: string; kind: string; hits: number; ms: number; top: string | null; failures: string[] }[] = [];
  let passed = 0;

  for (const c of SEARCH_CASES) {
    const t = Date.now();
    const out = searchCatalog(c.q, catalog);
    const ms = Date.now() - t;
    const failures = grade(c, out);
    if (failures.length === 0) passed++;
    const top = out.results[0]?.item.name ?? null;
    results.push({ q: c.q, kind: out.kind, hits: out.results.length, ms, top, failures });

    console.log(
      `  ${failures.length === 0 ? " " : "✗"} ${pad(JSON.stringify(c.q), 24)}${pad(out.kind, 12)}` +
      `${lp(out.results.length, 6)}${lp(ms, 7)}  ${(top ?? "—").slice(0, 44)}`,
    );
    for (const f of failures) console.log(`      ${f}`);
  }

  console.log("  " + "─".repeat(94));
  console.log(`\n  ${passed}/${SEARCH_CASES.length} cases pass\n`);

  emitJson({ total: SEARCH_CASES.length, passed, failed: SEARCH_CASES.length - passed, catalog: catalog.length, results });

  await prisma.$disconnect();
  if (passed < SEARCH_CASES.length) process.exit(1);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
