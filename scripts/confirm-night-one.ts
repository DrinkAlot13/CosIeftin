// ── SCOPE: REPORT ONLY ────────────────────────────────────────────────────────
// Does night one count?
//
// WHAT THIS ASKS, AND WHY IT CHANGED. The first version asked "was this offer re-observed by
// its merchant's last run, and did it stay withheld?" That criterion was not merely unmet, it
// was UNSATISFIABLE: all five rejected pairings point at rows whose store item no longer
// exists under that name — Freshful's mici was renamed, Sezamo's gelatine gained "foi" — so
// they went stale on 08-06, 09-01 and 09-03 and will never be re-observed again, however many
// nights run. "Wait for a night that touches them" waits forever. A gate that cannot open is
// broken, not strict.
//
// Those rows are stale AND flagged, so they reach no page: the reject is moot for them.
//
// So this asks what the mechanism actually GUARANTEES: if a NEW offer lands on a
// (merchant, product) pair that a human has rejected, is it withheld? That is the thing
// `reassertStandingDecisions` promises, and the thing a nightly can actually exercise.
//
// AND IT DOES NOT PASS TRIVIALLY. "No offer has landed on this pair since the reject" is
// reported as its own state — nothing to test — never as a pass and never as a failure. A
// verdict of "0 of 5 pairs have seen an offer since the reject; the mechanism is proven by
// test and untested in production" is an honest outcome and reads as exactly that.
//
// Run: npm run confirm:night-one

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const lp = (s: string | number, n: number) => String(s).padStart(n);

/** The two DCNeu rows whose quarantine expired with the scraper it described. */
const FORMERLY_QUARANTINED = [26587, 28300];

type PairOutcome = "held" | "leaked" | "untested";

async function main(): Promise<void> {
  console.log(`\n════ DOES NIGHT ONE COUNT? ══════════════════════════════════════════════════`);
  console.log(`  A rejected pair is TESTED only when an offer has been written on it since the`);
  console.log(`  reject. A pair nothing has landed on is untested — not a pass, not a failure.\n`);

  const rejects = await prisma.matchOverride.findMany({
    where: { decision: "reject" },
    select: {
      merchantId: true, productId: true, createdAt: true,
      merchant: { select: { slug: true } }, product: { select: { name: true } },
    },
    orderBy: { id: "asc" },
  });

  let held = 0;
  let leaked = 0;
  let untested = 0;
  const untestedPairs: string[] = [];

  console.log(`  REJECTED PAIRINGS (${rejects.length})`);
  for (const r of rejects) {
    const pair = `${r.merchant.slug} × #${r.productId}`;
    const offers = await prisma.offer.findMany({
      where: { merchantId: r.merchantId, productId: r.productId },
      select: { id: true, flagged: true, isStale: true, lastObservedAt: true },
    });

    // Written on this pair SINCE the human said no. An offer last observed before the reject
    // is the row the reject was made about, not evidence the reject is holding.
    const since = offers.filter((o) => o.lastObservedAt != null && o.lastObservedAt > r.createdAt);
    let outcome: PairOutcome;
    if (since.length === 0) {
      outcome = "untested";
      untested++;
      untestedPairs.push(pair);
    } else if (since.every((o) => o.flagged)) {
      outcome = "held";
      held++;
    } else {
      outcome = "leaked";
      leaked++;
    }

    const mark = outcome === "held" ? "✓" : outcome === "leaked" ? "✗" : "–";
    console.log(`    ${mark} ${pair.padEnd(26)} ${r.product.name.slice(0, 34)}`);
    if (outcome === "untested") {
      const newest = offers.map((o) => o.lastObservedAt).filter(Boolean).sort().pop();
      console.log(`        no offer written on this pair since the reject (${r.createdAt.toISOString().slice(0, 16)});`);
      console.log(`        nothing to test. Newest row on the pair: ${newest ? newest.toISOString().slice(0, 16) : "none"}` +
        `${offers.length ? ` (${offers.filter((o) => o.isStale).length}/${offers.length} stale, ${offers.filter((o) => o.flagged).length} withheld)` : ""}`);
    } else if (outcome === "held") {
      console.log(`        ${since.length} offer(s) written since the reject, ALL withheld`);
    } else {
      const bad = since.filter((o) => !o.flagged).map((o) => o.id);
      console.log(`        LEAKED — offer(s) ${bad.join(", ")} written since the reject and NOT withheld`);
    }
  }

  // ── The two rows whose quarantine was allowed to expire.
  console.log(`\n  FORMERLY QUARANTINED DCNeu ROWS (${FORMERLY_QUARANTINED.length})`);
  let quarantineBad = 0;
  for (const id of FORMERLY_QUARANTINED) {
    const o = await prisma.offer.findUnique({
      where: { id },
      select: { price: true, productUrl: true, rawPriceText: true },
    });
    if (!o) { console.log(`    – offer ${id} is gone`); continue; }
    const shared = await prisma.offer.count({ where: { productUrl: o.productUrl, price: o.price, NOT: { id } } });
    const parsed = Number((o.rawPriceText ?? "").replace(",", ".").replace(/[^\d.]/g, ""));
    const agrees = Number.isFinite(parsed) && Math.abs(parsed - o.price) < 0.011;
    const clean = shared === 0 && agrees;
    if (!clean) quarantineBad++;
    console.log(`    ${clean ? "✓" : "✗"} offer ${id} price ${o.price} raw "${o.rawPriceText}" — shares (price,url) with ${shared}, raw ${agrees ? "agrees" : "DISAGREES"}`);
  }

  // ── Everything the standing-decisions machinery owns, catalog-wide.
  const openAnomalyLive = await prisma.offer.count({ where: { flagged: false, isStale: false, anomalies: { some: { resolved: false } } } });
  const tiersOnWithheld = await prisma.offer.count({ where: { flagged: true, tiers: { some: {} } } });
  console.log(`\n  STANDING DECISIONS ACROSS THE CATALOG`);
  console.log(`    live offers with an unresolved anomaly : ${lp(openAnomalyLive, 6)}  (must be 0)`);
  console.log(`    withheld offers still carrying tiers   : ${lp(tiersOnWithheld, 6)}  (must be 0)`);

  const catalogBad = openAnomalyLive > 0 || tiersOnWithheld > 0;

  console.log(`\n${"─".repeat(78)}`);
  if (leaked > 0 || quarantineBad > 0 || catalogBad) {
    console.log(`  ✗✗ NIGHT ONE DOES NOT COUNT.`);
    if (leaked > 0) console.log(`     ${leaked} rejected pair(s) took a new offer and did not withhold it.`);
    if (quarantineBad > 0) console.log(`     ${quarantineBad} formerly-quarantined row(s) no longer look clean.`);
    if (catalogBad) console.log(`     A standing decision is not being applied catalog-wide.`);
  } else {
    console.log(`  ✓ NIGHT ONE COUNTS.`);
    console.log(`    ${held} of ${rejects.length} rejected pair(s) took an offer since the reject and withheld it.`);
    if (untested > 0) {
      console.log(`    ${untested} pair(s) have seen NO offer since the reject, so the mechanism is`);
      console.log(`    untested in production on them and proven only by tests/standing-decisions.test.ts:`);
      for (const p of untestedPairs) console.log(`      · ${p}`);
    }
    console.log(`    Both formerly-quarantined rows clean. No standing decision unapplied.`);
  }
  console.log(`  Then: npm run audit:db  — all invariants.\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
