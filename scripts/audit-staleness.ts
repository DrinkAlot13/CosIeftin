// How old are the prices we are showing as current?
//
// Three of four offers on one product were last actually seen on 6 August and were displayed as
// current prices 26 days later, one of them badged "cel mai mic preț". Carrefour at 10,49
// against a real 10,75, and Freshful at 17,99 against a real 24,99, are not parse errors — they
// were correct prices, a month ago.
//
// THE CAUSE. `lastSeenAt` is supposed to mean "this offer was observed in a feed this run".
// scripts/backfill-phase1.ts wrote it as `merchant.lastScrapeAt` for EVERY offer of that
// merchant, including the ones the scrape did not see. That makes it mean "the merchant ran",
// which is the opposite of what a staleness check needs, and every staleness check reads it.
//
// `lastSeen` was never touched by that backfill and holds the truth.
//
// Run: npm run audit:staleness              (report only)
//      npm run audit:staleness -- --repair  (set lastSeenAt back to lastSeen where it was
//                                            stamped forward; writes nothing else)

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const REPAIR = process.argv.includes("--repair");

/** Past this, a price is not a current price, whatever the page says. */
export const MAX_DISPLAY_AGE_DAYS = 14;

const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const lp = (s: string | number, n: number): string => String(s).padStart(n);

const BANDS: { label: string; maxDays: number }[] = [
  { label: "<24h", maxDays: 1 },
  { label: "1-7d", maxDays: 7 },
  { label: "7-14d", maxDays: 14 },
  { label: "14-30d", maxDays: 30 },
  { label: ">30d", maxDays: Infinity },
];

function bandOf(days: number): string {
  for (const b of BANDS) if (days <= b.maxDays) return b.label;
  return ">30d";
}

async function main(): Promise<void> {
  const now = Date.now();
  const offers = await prisma.offer.findMany({
    where: { merchant: { active: true } },
    select: {
      id: true, isStale: true, availability: true, lastSeen: true, lastSeenAt: true,
      merchant: { select: { slug: true } },
    },
  });

  // ── the divergence, first: which field can be trusted ──────────────────────────
  const stampedForward = offers.filter((o) => o.lastSeenAt && o.lastSeenAt.getTime() > o.lastSeen.getTime() + 86_400_000);
  console.log("\n════ WHICH FIELD IS TELLING THE TRUTH ════════════════════════════════════");
  console.log(`  offers whose lastSeenAt is MORE THAN A DAY AHEAD of lastSeen: ${stampedForward.length}`);
  console.log("  Those were stamped by backfill-phase1, which wrote the MERCHANT's lastScrapeAt");
  console.log("  onto every one of its offers — including the ones the scrape never saw.");
  console.log("  lastSeen is the observation. lastSeenAt, on those rows, is not.\n");

  // ── age distribution, computed from the truthful field ─────────────────────────
  type Row = Record<string, number> & { total: number; staleFlagged: number; oos: number; oldButLive: number };
  const byMerchant = new Map<string, Row>();
  const get = (k: string): Row => {
    let r = byMerchant.get(k);
    if (!r) {
      r = { total: 0, staleFlagged: 0, oos: 0, oldButLive: 0 } as Row;
      for (const b of BANDS) r[b.label] = 0;
      byMerchant.set(k, r);
    }
    return r;
  };

  for (const o of offers) {
    const days = (now - o.lastSeen.getTime()) / 86_400_000;
    const r = get(o.merchant.slug);
    r.total++;
    r[bandOf(days)]++;
    if (o.isStale) r.staleFlagged++;
    if (o.availability !== "in stock") r.oos++;
    // The dangerous population: old, yet not marked stale, so every read treats it as current.
    if (days > MAX_DISPLAY_AGE_DAYS && !o.isStale) r.oldButLive++;
  }

  console.log("════ AGE OF LIVE OFFERS, by lastSeen (the truthful field) ════════════════");
  console.log(`  ${pad("merchant", 14)}${lp("offers", 8)}${BANDS.map((b) => lp(b.label, 8)).join("")}${lp("isStale", 9)}${lp("oos", 7)}${lp("OLD+LIVE", 10)}`);
  let totalOldLive = 0;
  for (const [k, r] of [...byMerchant.entries()].sort((a, b) => b[1].oldButLive - a[1].oldButLive)) {
    totalOldLive += r.oldButLive;
    console.log(
      `  ${pad(k, 14)}${lp(r.total, 8)}${BANDS.map((b) => lp(r[b.label], 8)).join("")}` +
      `${lp(r.staleFlagged, 9)}${lp(r.oos, 7)}${lp(r.oldButLive, 10)}${r.oldButLive > 0 ? "  ⚠" : ""}`,
    );
  }
  console.log(`\n  OLD+LIVE = older than ${MAX_DISPLAY_AGE_DAYS} days and NOT flagged stale, so every read`);
  console.log(`  treats it as a current price. TOTAL: ${totalOldLive}`);

  // ── the number that says how bad this is on the site ───────────────────────────
  const products = await prisma.product.findMany({
    where: { offers: { some: { merchant: { active: true } } } },
    select: {
      id: true, name: true,
      offers: {
        where: { merchant: { active: true } },
        select: { price: true, isStale: true, availability: true, lastSeen: true, merchant: { select: { slug: true } } },
      },
    },
  });

  let headlineStale = 0;
  let headlineOos = 0;
  const examples: string[] = [];
  for (const p of products) {
    const usable = p.offers.filter((o) => o.price > 0);
    if (usable.length === 0) continue;
    // What the page calls "cel mai mic preț" today: cheapest, with no age or stock filter.
    const cheapest = usable.reduce((a, b) => (b.price < a.price ? b : a));
    const days = (now - cheapest.lastSeen.getTime()) / 86_400_000;
    const oos = cheapest.availability !== "in stock";
    if (days > MAX_DISPLAY_AGE_DAYS) headlineStale++;
    if (oos) headlineOos++;
    if ((days > MAX_DISPLAY_AGE_DAYS || oos) && examples.length < 15) {
      examples.push(
        `    ${p.name.slice(0, 52).padEnd(54)} ${cheapest.price.toFixed(2).padStart(8)} lei  ` +
        `[${cheapest.merchant.slug}] ${days.toFixed(0)}d${oos ? " OUT OF STOCK" : ""}`,
      );
    }
  }

  console.log("\n════ PRODUCT PAGES SHOWING A BAD HEADLINE PRICE ══════════════════════════");
  console.log(`  products with at least one offer:            ${products.length}`);
  console.log(`  headline price is older than ${MAX_DISPLAY_AGE_DAYS} days:        ${headlineStale}`);
  console.log(`  headline price is OUT OF STOCK:             ${headlineOos}`);
  console.log("\n  examples:");
  console.log(examples.join("\n"));

  // ── repair ─────────────────────────────────────────────────────────────────────
  if (REPAIR) {
    console.log(`\n  repairing ${stampedForward.length} rows: lastSeenAt := lastSeen …`);
    let n = 0;
    for (const o of stampedForward) {
      await prisma.offer.update({ where: { id: o.id }, data: { lastSeenAt: o.lastSeen } });
      if (++n % 1000 === 0) process.stdout.write(`\r  ${n}/${stampedForward.length}`);
    }
    const left = await prisma.offer.count({
      where: { lastSeenAt: { not: null } },
    });
    void left;
    const stillAhead = (await prisma.offer.findMany({ select: { lastSeen: true, lastSeenAt: true } }))
      .filter((o) => o.lastSeenAt && o.lastSeenAt.getTime() > o.lastSeen.getTime() + 86_400_000).length;
    console.log(`\r  ${n} repaired. Still stamped forward: ${stillAhead}`);
    console.log(stillAhead === 0 ? "\n✓ lastSeenAt now means what it says\n" : "\n✗ REPAIR INCOMPLETE\n");
  } else {
    console.log("\n  (report only — pass --repair to set lastSeenAt back to lastSeen)\n");
  }

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
