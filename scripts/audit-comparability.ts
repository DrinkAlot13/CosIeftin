// THE NUMBER. How much of this catalog actually compares two shops' prices for one product?
//
// Everything else in this project is in service of this figure, and it has been quoted three
// different ways in three sessions because nobody pinned the definition. So the definition is
// stated here, in code, once:
//
//   A product is COMPARABLE when at least two DIFFERENT merchants each have an offer on it
//   that a shopper would actually be shown — in stock, not stale, not flagged, and observed
//   recently enough to still be a current price.
//
// Every clause of that costs comparability, and the point of measuring is to see how much
// each one costs rather than arguing about it:
//
//   raw            two or more merchants, any state at all
//   in stock       drop out-of-stock offers
//   fresh          drop offers older than MAX_DISPLAY_AGE_DAYS
//   not flagged    drop offers a gate withheld
//   ALL            the number a shopper experiences
//
// Read-only. Run: npm run audit:comparability

import { PrismaClient } from "@prisma/client";
import { MAX_DISPLAY_AGE_DAYS } from "../src/lib/pricing";

const prisma = new PrismaClient();

const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const lp = (s: string | number, n: number): string => String(s).padStart(n);
const pct = (n: number, d: number): string => (d === 0 ? "0.0%" : ((n / d) * 100).toFixed(1) + "%");

type Row = {
  merchantId: number;
  isStale: boolean;
  flagged: boolean;
  availability: string;
  lastObservedAt: Date | null;
  priceSource: string;
  priceBani: number | null;
  price: number;
};

/** Distinct merchants whose offers survive a filter. */
function merchants(offers: Row[], keep: (o: Row) => boolean): number {
  const s = new Set<number>();
  for (const o of offers) if (keep(o)) s.add(o.merchantId);
  return s.size;
}

async function main(): Promise<void> {
  const now = Date.now();
  const cutoff = now - MAX_DISPLAY_AGE_DAYS * 86_400_000;

  const products = await prisma.product.findMany({
    where: { offers: { some: { merchant: { active: true } } } },
    select: {
      id: true, section: true,
      offers: {
        where: { merchant: { active: true } },
        select: {
          merchantId: true, isStale: true, flagged: true, availability: true,
          lastObservedAt: true, priceSource: true, priceBani: true, price: true,
        },
      },
    },
  });

  const hasPrice = (o: Row): boolean => (o.priceBani ?? Math.round(o.price * 100)) > 0;
  const inStock = (o: Row): boolean => o.availability === "in stock" && !o.isStale;
  // A FLYER offer expires by its promo window, not by observation age — the one exemption.
  const fresh = (o: Row): boolean =>
    o.priceSource === "FLYER" || (o.lastObservedAt != null && o.lastObservedAt.getTime() >= cutoff);
  const unflagged = (o: Row): boolean => !o.flagged;

  const FILTERS: { label: string; keep: (o: Row) => boolean }[] = [
    { label: "raw (any state)", keep: hasPrice },
    { label: "+ in stock", keep: (o) => hasPrice(o) && inStock(o) },
    { label: "+ fresh", keep: (o) => hasPrice(o) && fresh(o) },
    { label: "+ not flagged", keep: (o) => hasPrice(o) && unflagged(o) },
    { label: "ALL (what a shopper sees)", keep: (o) => hasPrice(o) && inStock(o) && fresh(o) && unflagged(o) },
  ];

  console.log(`\n════ COMPARABILITY ══════════════════════════════════════════════════════════`);
  console.log(`  A product is comparable when TWO OR MORE merchants each have an offer a`);
  console.log(`  shopper would actually be shown. Freshness cutoff: ${MAX_DISPLAY_AGE_DAYS} days.\n`);
  console.log(`  ${pad("filter", 28)}${lp("comparable", 12)}${lp("of", 9)}${lp("share", 9)}`);
  for (const f of FILTERS) {
    const n = products.filter((p) => merchants(p.offers as Row[], f.keep) >= 2).length;
    console.log(`  ${pad(f.label, 28)}${lp(n, 12)}${lp(products.length, 9)}${lp(pct(n, products.length), 9)}`);
  }

  // ── Per section, on the honest filter only.
  const all = FILTERS[FILTERS.length - 1].keep;
  const bySection = new Map<string, { total: number; comparable: number }>();
  for (const p of products) {
    const e = bySection.get(p.section) ?? { total: 0, comparable: 0 };
    e.total++;
    if (merchants(p.offers as Row[], all) >= 2) e.comparable++;
    bySection.set(p.section, e);
  }
  console.log(`\n  BY SECTION, on the honest filter:`);
  console.log(`  ${pad("section", 14)}${lp("products", 11)}${lp("comparable", 12)}${lp("share", 9)}`);
  for (const [k, e] of [...bySection.entries()].sort((a, b) => b[1].comparable - a[1].comparable)) {
    console.log(`  ${pad(k, 14)}${lp(e.total, 11)}${lp(e.comparable, 12)}${lp(pct(e.comparable, e.total), 9)}`);
  }

  // ── WHERE THE LOSS GOES. For products that are raw-comparable but not honestly so, which
  //    clause killed them? A product can fail more than one, so this attributes to the FIRST
  //    clause that alone would have been enough — otherwise the columns double-count.
  let lostStock = 0, lostFresh = 0, lostFlag = 0;
  for (const p of products) {
    const o = p.offers as Row[];
    if (merchants(o, hasPrice) < 2) continue;
    if (merchants(o, all) >= 2) continue;
    if (merchants(o, (x) => hasPrice(x) && inStock(x)) < 2) lostStock++;
    else if (merchants(o, (x) => hasPrice(x) && fresh(x)) < 2) lostFresh++;
    else lostFlag++;
  }
  console.log(`\n  WHERE COMPARABILITY IS LOST (first sufficient cause, so no double counting):`);
  console.log(`    out of stock:  ${lostStock}`);
  console.log(`    stale:         ${lostFresh}`);
  console.log(`    flagged:       ${lostFlag}`);

  // ── The headline a shopper sees on a single-merchant product is still a price we publish.
  const withAny = products.filter((p) => merchants(p.offers as Row[], all) >= 1).length;
  console.log(`\n  products with at least ONE showable price: ${withAny} (${pct(withAny, products.length)})`);
  console.log(`  products with NO showable price at all:    ${products.length - withAny}`);
  console.log(`\n  The second number is the one that matters for trust: a page with no current`);
  console.log(`  price must say so rather than show an old one.\n`);

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
