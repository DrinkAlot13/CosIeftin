// ── SCOPE: DATA INTEGRITY ─────────────────────────────────────────────────────
// HOW MUCH DID EACH SCRAPER FIND, night by night? READ-ONLY.
//
// THE GAP THIS EXISTS TO SHOW. Every guard in this project watches what happened AFTER the pool
// was built: `matchPoolToCatalog` refuses a run whose offers collapse to under 60% of the
// merchant's live rows, `audit:db` checks written counts, the census explains where withheld
// rows went. All of them are downstream of discovery.
//
// So a run that discovers a third of the catalog and writes it flawlessly looks perfectly
// healthy:
//
//     carrefour 2026-09-08 05:14   pooled 3944   wrote 4014     <- healthy
//     carrefour 2026-09-08 06:55   pooled 1209   wrote 1197     <- 99% write rate, 31% of a pool
//
// The write RATIO is what the guards read, and it stayed at 99%. Both ends collapsed together,
// so nothing fired. This report shows the end nobody was watching.
//
// `offersAttempted` is used as the pool measure. It counts price parses attempted, which is one
// per pool item carrying a price — not identical to pool size, but the only pool-shaped number
// recorded for runs before tonight. `ScraperRun.poolSize` is recorded from now on and is
// authoritative once there is history in it; this report says which one it used.
//
//   npm run audit:pool-history
//   npm run audit:pool-history -- --days=30

import { PrismaClient } from "@prisma/client";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();

/** A run pooling under this share of the merchant's own recent MEDIAN is a collapse. */
const COLLAPSE_RATIO = 0.6;

function day(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function main(): Promise<void> {
  const days = Number((process.argv.find((a) => a.startsWith("--days=")) ?? "--days=14").split("=")[1]);
  const since = new Date(Date.now() - days * 86_400_000);

  const merchants = await prisma.merchant.findMany({ select: { id: true, slug: true }, orderBy: { slug: "asc" } });
  const runs = await prisma.scraperRun.findMany({
    where: { startedAt: { gte: since } },
    orderBy: { startedAt: "asc" },
    select: { merchantId: true, startedAt: true, offersAttempted: true, offersWritten: true, poolSize: true, aborted: true, abortReason: true },
  });

  const dayKeys = [...new Set(runs.map((r) => day(r.startedAt)))].sort();
  console.log("═".repeat(112));
  console.log(`POOL SIZE PER NIGHT — what each scraper FOUND, over ${days} days`);
  console.log(`The number every existing guard is downstream of.`);
  console.log("═".repeat(112));
  console.log(`  ${"merchant".padEnd(16)} ${dayKeys.map((d) => d.slice(5)).join("  ")}`);

  const findings: { merchant: string; date: string; pooled: number; best: number; ratio: number }[] = [];
  const perMerchant: Record<string, unknown>[] = [];

  for (const m of merchants) {
    const mine = runs.filter((r) => r.merchantId === m.id);
    if (mine.length === 0) continue;

    // ONE NUMBER PER DAY: the BIGGEST pool that day. A day with a good run and a collapsed one
    // is a day the catalog was found — the collapse is a separate finding, reported below.
    const byDay = new Map<string, number>();
    for (const r of mine) {
      const pooled = r.poolSize ?? r.offersAttempted;
      byDay.set(day(r.startedAt), Math.max(byDay.get(day(r.startedAt)) ?? 0, pooled));
    }
    const cells = dayKeys.map((d) => {
      const v = byDay.get(d);
      return (v == null ? "—" : String(v)).padStart(d.slice(5).length);
    });
    console.log(`  ${m.slug.padEnd(16)} ${cells.join("  ")}`);

    // The collapse test, per RUN rather than per day: a run pooling under 60% of this
    // merchant's own recent best pool.
    // THE MEDIAN, NOT THE MAXIMUM — a flyer catalog varies by design. Kaufland pooled 540, 247
    // and 500 on consecutive weeks as promotions started and ended; against the maximum every
    // short flyer week reads as a 49% collapse. The median absorbs the cycle and still catches
    // a real one. Same rule the guard in matchPoolToCatalog uses, deliberately.
    const pools = mine.map((r) => r.poolSize ?? r.offersAttempted).filter((n) => n > 0).sort((a, b) => a - b);
    const median = pools.length >= 3 ? pools[Math.floor(pools.length / 2)] : 0;
    for (const r of mine) {
      const pooled = r.poolSize ?? r.offersAttempted;
      if (median > 0 && pooled > 0 && pooled < median * COLLAPSE_RATIO) {
        findings.push({ merchant: m.slug, date: r.startedAt.toISOString().slice(0, 16).replace("T", " "), pooled, best: median, ratio: pooled / median });
      }
    }
    perMerchant.push({ merchant: m.slug, runs: mine.length, medianPool: median, byDay: Object.fromEntries(byDay) });
  }

  console.log(`\n${"─".repeat(112)}`);
  console.log(`RUNS THAT POOLED UNDER ${(COLLAPSE_RATIO * 100).toFixed(0)}% OF THEIR MERCHANT'S RECENT MEDIAN`);
  console.log(`Not a verdict on the merchant — a run that found a fraction of what it found before.`);
  console.log("─".repeat(112));
  if (findings.length === 0) {
    console.log(`  none in ${days} days.`);
  } else {
    console.log(`  ${"merchant".padEnd(16)} ${"when".padEnd(17)} ${"pooled".padStart(7)} ${"median".padStart(7)} ${"ratio".padStart(6)}`);
    for (const f of findings.sort((a, b) => a.ratio - b.ratio)) {
      console.log(`  ${f.merchant.padEnd(16)} ${f.date.padEnd(17)} ${String(f.pooled).padStart(7)} ${String(f.best).padStart(7)} ${(f.ratio * 100).toFixed(0).padStart(5)}%`);
    }
  }

  console.log(`
  TWO THINGS THIS LIST CANNOT SEE, and both are in it right now:`);
  console.log(`  1. SECTION. Runs before 2026-09-08 carry none, and more than one scraper writes to`);
  console.log(`     one merchant row — carrefour's ~1,212 entries are scrape-carrefour-alcohol,`);
  console.log(`     which genuinely covers 1,243 offers, not a collapse of the ~4,000 grocery run.`);
  console.log(`     The GUARD is section-scoped; this backward-looking report cannot be.`);
  console.log(`  2. STEP CHANGES. dcneu moved from ~6,000 to ~10,700 on 2026-09-02 and stayed there,`);
  console.log(`     so the older runs read as 56% of a median they predate. The guard compares only`);
  console.log(`     the last 14 days, so a step change becomes the new normal within days.`);

  const usingProxy = runs.filter((r) => r.poolSize == null).length;
  console.log(`\n  ${runs.length} runs in window · ${usingProxy} measured by offersAttempted (the proxy),`);
  console.log(`  ${runs.length - usingProxy} by the recorded poolSize. Old runs have no poolSize because the`);
  console.log(`  column did not exist — that is UNKNOWN, not zero.`);

  emitJson({ days, collapses: findings, merchants: perMerchant, pass: true });
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
