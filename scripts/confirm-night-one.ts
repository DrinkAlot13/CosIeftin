// ── SCOPE: REPORT ONLY ────────────────────────────────────────────────────────
// Does night one count?
//
// The standing-decisions fix is proven by a test that reproduces the failure deterministically.
// What it is NOT yet proven by is a real nightly that actually re-touched the rows — the
// freshful re-scrape left offer 37483 alone (lastObservedAt 15:02), so nothing was re-written
// and nothing was really tested. This script asks the question that matters the morning after:
//
//   did a run that DID rewrite these rows leave the standing decisions standing?
//
// An offer that was not re-observed by the run proves nothing either way, and this says so
// rather than counting it as a pass. That distinction is the whole point: a check that reports
// success because nothing happened is the failure mode this project keeps finding.
//
// Run: npm run confirm:night-one

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const lp = (s: string | number, n: number) => String(s).padStart(n);

/** The two DCNeu rows whose quarantine expired with the scraper it described. */
const FORMERLY_QUARANTINED = [26587, 28300];

async function main(): Promise<void> {
  // "Re-observed" is measured against THE MERCHANT'S OWN LAST RUN, not a fixed window. A
  // generous 20-hour window called offer 37483 "rewritten" because something had touched it
  // earlier that day — which is exactly the too-easy pass this script exists to refuse. A row
  // counts as tested only if it was observed at or after the run that could have undone it.
  console.log(`\n════ DOES NIGHT ONE COUNT? ══════════════════════════════════════════════════`);
  console.log(`  A row counts as tested only if its merchant's LAST RUN re-observed it.\n`);
  const lastRunOf = new Map<number, Date>();
  for (const m of await prisma.merchant.findMany({ select: { id: true } })) {
    const r = await prisma.scraperRun.findFirst({
      where: { merchantId: m.id, aborted: false },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true },
    });
    if (r) lastRunOf.set(m.id, r.startedAt);
  }

  // ── 1. The five rejected pairings.
  const rejects = await prisma.matchOverride.findMany({
    where: { decision: "reject" },
    select: { merchantId: true, productId: true, merchant: { select: { slug: true } }, product: { select: { name: true } } },
  });
  let untested = 0;
  let bad = 0;
  console.log(`  REJECTED PAIRINGS (${rejects.length})`);
  for (const r of rejects) {
    const o = await prisma.offer.findFirst({
      where: { merchantId: r.merchantId, productId: r.productId },
      select: { id: true, flagged: true, lastObservedAt: true, storeName: true },
    });
    if (!o) { console.log(`    ✓ ${r.merchant.slug.padEnd(12)} no offer at all — honoured`); continue; }
    const runAt = lastRunOf.get(r.merchantId);
    const touched = o.lastObservedAt != null && runAt != null && o.lastObservedAt >= runAt;
    if (!touched) { untested++; console.log(`    – ${r.merchant.slug.padEnd(12)} offer ${o.id} NOT re-observed by this run — proves nothing`); continue; }
    if (o.flagged) console.log(`    ✓ ${r.merchant.slug.padEnd(12)} offer ${o.id} rewritten AND still withheld`);
    else { bad++; console.log(`    ✗ ${r.merchant.slug.padEnd(12)} offer ${o.id} rewritten and LIVE — the reject did not hold`); }
  }

  // ── 2. The two rows whose quarantine was allowed to expire.
  console.log(`\n  FORMERLY QUARANTINED DCNeu ROWS (${FORMERLY_QUARANTINED.length})`);
  for (const id of FORMERLY_QUARANTINED) {
    const o = await prisma.offer.findUnique({
      where: { id },
      select: { price: true, productUrl: true, flagged: true, rawPriceText: true, lastObservedAt: true },
    });
    if (!o) { console.log(`    – offer ${id} is gone`); continue; }
    const shared = await prisma.offer.count({ where: { productUrl: o.productUrl, price: o.price, NOT: { id } } });
    const parsed = Number((o.rawPriceText ?? "").replace(",", ".").replace(/[^\d.]/g, ""));
    const agrees = Number.isFinite(parsed) && Math.abs(parsed - o.price) < 0.011;
    const clean = shared === 0 && agrees;
    console.log(`    ${clean ? "✓" : "✗"} offer ${id} price ${o.price} raw "${o.rawPriceText}" — shares (price,url) with ${shared}, raw ${agrees ? "agrees" : "DISAGREES"}`);
    if (!clean) bad++;
  }

  // ── 3. Everything the audit knows.
  const openAnomalyLive = await prisma.offer.count({ where: { flagged: false, isStale: false, anomalies: { some: { resolved: false } } } });
  const tiersOnWithheld = await prisma.offer.count({ where: { flagged: true, tiers: { some: {} } } });
  console.log(`\n  STANDING DECISIONS ACROSS THE CATALOG`);
  console.log(`    live offers with an unresolved anomaly : ${lp(openAnomalyLive, 6)}  (must be 0)`);
  console.log(`    withheld offers still carrying tiers   : ${lp(tiersOnWithheld, 6)}  (must be 0)`);
  if (openAnomalyLive > 0 || tiersOnWithheld > 0) bad++;

  console.log(`\n${"─".repeat(78)}`);
  if (bad > 0) {
    console.log(`  ✗✗ NIGHT ONE DOES NOT COUNT — ${bad} problem(s) above.`);
  } else if (untested > 0) {
    console.log(`  ⚠ INCONCLUSIVE — ${untested} rejected pairing(s) were not re-observed by this run,`);
    console.log(`    so the rewrite path was not exercised on them. Nothing is wrong; nothing is`);
    console.log(`    proven either. Re-run after a night that touches them.`);
  } else {
    console.log(`  ✓ Every standing decision survived a run that actually rewrote its rows.`);
    console.log(`    Night one counts.`);
  }
  console.log(`  Then: npm run audit:db  — all invariants.\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
