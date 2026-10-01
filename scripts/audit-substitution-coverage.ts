// THE USER-MANDATED TEST PROTOCOL for the structural-equivalence fallback
// (`src/lib/substitution/structural-equivalence.ts`): take a RANDOM sample of real grocery
// products, POST them to the REAL `/api/basket/shop` endpoint — exactly the "Completează coșul
// la X" button a shopper clicks — for EVERY active grocery merchant, and report what fraction
// of the basket each merchant actually delivers (exact match OR accepted substitute). The bar
// is 95% per merchant. Below that for ANY merchant, the approach gets revised and this script
// run again — per the instruction this exists to satisfy, not stopping until it clears or a
// measured limit is reported honestly.
//
// Why over HTTP against the real route, not a re-implementation: `audit-real-basket.ts` set this
// precedent — the brief's rule is to verify by rendered output, never from the source that
// produced it. A script that recomputes "coverage" with its own copy of the resolver proves
// nothing about what `/api/basket/shop` actually returns; it proves the copy agrees with itself.
//
// WHY RANDOM, EVERY RUN: a fixed basket (see `INDEX_BASKET`, used by audit-real-basket) can be
// unknowingly curated toward whatever the matcher already handles well. Random sampling is the
// only way "50 items" means what the instruction means by it.
//
//   npm run audit:substitution-coverage
//   npm run audit:substitution-coverage -- --n=50 --seed=1 --url=http://localhost:3000
//
// ── MEASURED HISTORY (what each iteration actually achieved; update this on every real run) ──
//
//   iteration 1 — curated EquivalenceClass only (no structural fallback).
//     3.7% of grocery products carry a class. Expectation: most merchants far under 95% on any
//     random sample, because EQUIVALENT silently collapses to exact-match for 96.3% of lines.
//
//   iteration 2 — + structural fallback, STRUCTURAL_SIZE_TOLERANCE = 0.35, light mutual
//     distinction (block only when BOTH sides carry >=2 unshared significant tokens).
//     Run this script and record the actual per-merchant numbers here, with the date, before
//     calling the feature done. Do not hand-wave this line.

import { prisma } from "../src/lib/db";
import { emitJson } from "../src/lib/audit-json";

const COVERAGE_BAR = 0.95;

type ShopResponse = {
  summary: { itemCount: number; found: number; substituted: number; unavailable: number };
  lines: { slug: string; status: string }[];
  error?: string;
};

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : fallback;
}

/** A small, seedable PRNG so a failing run can be reproduced with the same sample. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickRandom<T>(pool: T[], n: number, rng: () => number): T[] {
  const copy = [...pool];
  const out: T[] = [];
  while (out.length < n && copy.length > 0) {
    const i = Math.floor(rng() * copy.length);
    out.push(copy.splice(i, 1)[0]);
  }
  return out;
}

async function main(): Promise<void> {
  const N = Number(arg("n", "50"));
  const seed = Number(arg("seed", String(Date.now() | 0)));
  const base = arg("url", "http://localhost:3000");
  const rng = mulberry32(seed);

  // The real pool a shopper can actually add: grocery products with at least one live,
  // in-stock offer somewhere. Sampling from the full catalog including dead-stock rows would
  // test a basket nobody could actually build.
  const candidates = await prisma.product.findMany({
    where: { section: "grocery", offers: { some: { availability: "in stock", isStale: false, flagged: false } } },
    select: { slug: true, name: true },
  });
  if (candidates.length < N) throw new Error(`only ${candidates.length} eligible grocery products — need ${N}`);
  const sample = pickRandom(candidates, N, rng);

  const merchants = await prisma.merchant.findMany({
    where: { active: true, offers: { some: { product: { section: "grocery" } } } },
    select: { slug: true, name: true },
  });
  if (merchants.length === 0) throw new Error("no active merchant carries any grocery offer");

  console.log("═".repeat(100));
  console.log(`SUBSTITUTION COVERAGE — ${N} random grocery items (seed ${seed}), ${merchants.length} merchants`);
  console.log("═".repeat(100));
  for (const [i, p] of sample.entries()) console.log(`  ${String(i + 1).padStart(2)}. ${p.name.slice(0, 72)}`);
  console.log();

  const items = sample.map((p) => ({ slug: p.slug, qty: 1, mode: "EQUIVALENT" }));

  const rows: { merchant: string; found: number; total: number; pct: number; exact: number; substituted: number }[] = [];
  for (const m of merchants) {
    const res = await fetch(`${base}/api/basket/shop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, merchantSlug: m.slug }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      console.log(`  ${m.name.padEnd(20)} HTTP ${res.status} — ${(await res.text()).slice(0, 120)}`);
      rows.push({ merchant: m.name, found: 0, total: N, pct: 0, exact: 0, substituted: 0 });
      continue;
    }
    const out = (await res.json()) as ShopResponse;
    const exact = out.lines.filter((l) => l.status === "EXACT").length;
    const substituted = out.lines.filter((l) => l.status === "SUBSTITUTED").length;
    const found = out.summary.found;
    const pct = found / out.summary.itemCount;
    rows.push({ merchant: m.name, found, total: out.summary.itemCount, pct, exact, substituted });
  }

  console.log("─".repeat(100));
  console.log(`${"MERCHANT".padEnd(22)}${"COVERAGE".padEnd(12)}${"EXACT".padEnd(8)}${"SUBST".padEnd(8)}${"MISSING".padEnd(8)}VERDICT`);
  console.log("─".repeat(100));
  let allPass = true;
  for (const r of rows.sort((a, b) => a.pct - b.pct)) {
    const pass = r.pct >= COVERAGE_BAR;
    if (!pass) allPass = false;
    const pctStr = `${(r.pct * 100).toFixed(0)}% (${r.found}/${r.total})`;
    console.log(
      `${r.merchant.padEnd(22)}${pctStr.padEnd(12)}${String(r.exact).padEnd(8)}${String(r.substituted).padEnd(8)}${String(r.total - r.found).padEnd(8)}${pass ? "✓ PASS" : "✗ FAIL (<95%)"}`,
    );
  }
  console.log("─".repeat(100));
  console.log(allPass ? "ALL MERCHANTS CLEAR 95%." : "AT LEAST ONE MERCHANT IS BELOW 95% — revise and rerun.");

  emitJson({ n: N, seed, merchants: rows.length, pass: allPass, rows });
  process.exitCode = allPass ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
