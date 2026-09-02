// ── SCOPE: DATA INTEGRITY ─────────────────────────────────────────────────────
// Counts EVERY row, shown or not — the age of every stored offer, shown or not.
// That is deliberate and is the opposite of the user-facing audits: a withheld row is
// still data, and a corruption hiding inside one is still a corruption. Do not add a
// visibility filter here.
// How old are the prices we present as current, and do we know when we saw them?
//
// Three of four offers on one product were last actually observed on 6 August and were shown as
// current prices 26 days later, one badged "cel mai mic preț". Carrefour at 10,49 against a real
// 10,75 and Freshful at 17,99 against a real 24,99 were not parse errors — they were correct
// prices, a month ago.
//
// The cause was two fields with near-identical names, `lastSeen` and `lastSeenAt`, written by
// the same two scrapers at the same instant. One of them was then corrupted by a merchant-level
// backfill that stamped `merchant.lastScrapeAt` onto every offer of that merchant, including
// the ones the scrape never saw. They are now one field, `lastObservedAt`, and this audit
// watches the two things that can still go wrong with it.
//
// Read-only. Run: npm run audit:staleness

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** Past this, a price is not a current price, whatever the page says. */
export const MAX_DISPLAY_AGE_DAYS = 14;

const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const lp = (s: string | number, n: number): string => String(s).padStart(n);

const BANDS = [
  { label: "<24h", maxDays: 1 },
  { label: "1-7d", maxDays: 7 },
  { label: "7-14d", maxDays: 14 },
  { label: "14-30d", maxDays: 30 },
  { label: ">30d", maxDays: Infinity },
] as const;

function bandOf(days: number): string {
  for (const b of BANDS) if (days <= b.maxDays) return b.label;
  return ">30d";
}

async function main(): Promise<void> {
  const now = Date.now();
  const offers = await prisma.offer.findMany({
    where: { merchant: { active: true } },
    select: {
      id: true, isStale: true, availability: true, lastObservedAt: true, priceSource: true,
      merchant: { select: { slug: true } },
    },
  });

  type Row = Record<string, number> & { total: number; staleFlagged: number; oos: number; oldButLive: number; noDate: number; noDateNonFlyer: number };
  const byMerchant = new Map<string, Row>();
  const get = (k: string): Row => {
    let r = byMerchant.get(k);
    if (!r) {
      r = { total: 0, staleFlagged: 0, oos: 0, oldButLive: 0, noDate: 0, noDateNonFlyer: 0 } as Row;
      for (const b of BANDS) r[b.label] = 0;
      byMerchant.set(k, r);
    }
    return r;
  };

  for (const o of offers) {
    const r = get(o.merchant.slug);
    r.total++;
    if (o.isStale) r.staleFlagged++;
    if (o.availability !== "in stock") r.oos++;

    if (!o.lastObservedAt) {
      r.noDate++;
      // A FLYER offer expires by its promo window and needs no observation date. Any other
      // source with a null date means we did not see it — and after a full scrape that is a
      // writer producing offers it never observed.
      if ((o.priceSource ?? "") !== "FLYER") r.noDateNonFlyer++;
      continue;
    }
    const days = (now - o.lastObservedAt.getTime()) / 86_400_000;
    r[bandOf(days)]++;
    if (days > MAX_DISPLAY_AGE_DAYS && !o.isStale) r.oldButLive++;
  }

  console.log("\n════ AGE OF OFFERS, by lastObservedAt ════════════════════════════════════");
  console.log(
    `  ${pad("merchant", 14)}${lp("offers", 8)}${BANDS.map((b) => lp(b.label, 8)).join("")}` +
    `${lp("no date", 9)}${lp("isStale", 9)}${lp("oos", 7)}${lp("OLD+LIVE", 10)}`,
  );
  let totalOldLive = 0;
  let totalNoDateNonFlyer = 0;
  for (const [k, r] of [...byMerchant.entries()].sort((a, b) => b[1].oldButLive - a[1].oldButLive)) {
    totalOldLive += r.oldButLive;
    totalNoDateNonFlyer += r.noDateNonFlyer;
    console.log(
      `  ${pad(k, 14)}${lp(r.total, 8)}${BANDS.map((b) => lp(r[b.label], 8)).join("")}` +
      `${lp(r.noDate, 9)}${lp(r.staleFlagged, 9)}${lp(r.oos, 7)}${lp(r.oldButLive, 10)}${r.oldButLive > 0 ? "  ⚠" : ""}`,
    );
  }
  console.log(`\n  OLD+LIVE = older than ${MAX_DISPLAY_AGE_DAYS} days and NOT flagged stale, so a naive read`);
  console.log(`  treats it as current. TOTAL: ${totalOldLive}`);
  console.log(`\n  NON-FLYER OFFERS WITH NO OBSERVATION DATE: ${totalNoDateNonFlyer}`);
  console.log("  Should be near zero after a full scrape. If it is not, something is writing");
  console.log("  offers without observing them — which is how the last outage started.");

  // ── what a shopper would actually see as the headline ──────────────────────────
  const products = await prisma.product.findMany({
    where: { offers: { some: { merchant: { active: true } } } },
    select: {
      id: true, name: true,
      offers: {
        where: { merchant: { active: true } },
        select: {
          price: true, isStale: true, availability: true, lastObservedAt: true, priceSource: true,
          merchant: { select: { slug: true } },
        },
      },
    },
  });

  let headlineStale = 0;
  let headlineOos = 0;
  const examples: string[] = [];
  for (const p of products) {
    const usable = p.offers.filter((o) => o.price > 0);
    if (usable.length === 0) continue;
    // The cheapest with NO age or stock filter — what the page used to show.
    const cheapest = usable.reduce((a, b) => (b.price < a.price ? b : a));
    const days = cheapest.lastObservedAt ? (now - cheapest.lastObservedAt.getTime()) / 86_400_000 : Infinity;
    const oos = cheapest.availability !== "in stock";
    if (days > MAX_DISPLAY_AGE_DAYS) headlineStale++;
    if (oos) headlineOos++;
    if ((days > MAX_DISPLAY_AGE_DAYS || oos) && examples.length < 12) {
      examples.push(
        `    ${p.name.slice(0, 50).padEnd(52)} ${cheapest.price.toFixed(2).padStart(8)} lei  ` +
        `[${cheapest.merchant.slug}] ${Number.isFinite(days) ? days.toFixed(0) + "d" : "no date"}${oos ? " OUT OF STOCK" : ""}`,
      );
    }
  }

  console.log("\n════ PRODUCTS WHOSE CHEAPEST OFFER IS NOT CURRENT ════════════════════════");
  console.log("  (the display layer now withholds these; this counts the underlying data)");
  console.log(`  products with at least one offer:      ${products.length}`);
  console.log(`  cheapest is older than ${MAX_DISPLAY_AGE_DAYS} days:      ${headlineStale}`);
  console.log(`  cheapest is OUT OF STOCK:             ${headlineOos}`);
  console.log("\n  examples:");
  console.log(examples.join("\n"));
  console.log();
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
