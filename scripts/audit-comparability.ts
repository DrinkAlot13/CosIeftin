// ── SCOPE: USER-FACING ────────────────────────────────────────────────────────
// Counts ONLY rows that reach a page — what a shopper can compare right now.
// A withheld, flagged, stale-and-hidden or quarantined row is on no page and cannot
// mislead anyone, so counting it reports a defect the site does not have. Three checks
// did exactly that and returned 8,822, 22 and 46 phantom failures; an audit that does
// not share the display's definition of "shown" trains you to ignore it, which is as
// dangerous as one that misses real defects.
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
import { emitJson } from "../src/lib/audit-json";
import { MAX_DISPLAY_AGE_DAYS } from "../src/lib/pricing";
import { sectionKind } from "../src/lib/section-type";
import { deliveryPlatformEnabledByEnv } from "../src/lib/platform/visibility";

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

  // DELIVERY_PLATFORM offers are excluded unless explicitly enabled, exactly as every display
  // surface excludes them. Counting a Glovo price toward comparability would inflate the number
  // with prices the site does not show and would not let compete anyway.
  const showDP = deliveryPlatformEnabledByEnv();
  const hasPrice = (o: Row): boolean =>
    (o.priceBani ?? Math.round(o.price * 100)) > 0 && (showDP || o.priceSource !== "DELIVERY_PLATFORM");
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
  // ── THE SPLIT. Comparison sections get comparability; price sections get coverage.
  //
  //    A blended figure measures catalog COMPOSITION, not matching quality. DCNeu grew from
  //    6,019 to 12,914 products when its scraper stopped truncating, and the headline fell
  //    from 5.6% to 5.0% — the catalog got strictly better and the metric got worse, because
  //    6,895 single-merchant products joined the denominator. A number that falls when you fix
  //    a bug is measuring the wrong thing.
  const cmp = { products: 0, comparable: 0 };
  const prc = { products: 0, withOffer: 0, offers: 0, withTiers: 0 };
  for (const p of products) {
    if (sectionKind(p.section) === "comparison") {
      cmp.products++;
      if (merchants(p.offers as Row[], all) >= 2) cmp.comparable++;
    } else {
      prc.products++;
      const shown = (p.offers as Row[]).filter(all);
      if (shown.length > 0) prc.withOffer++;
      prc.offers += shown.length;
    }
  }
  prc.withTiers = await prisma.offer.count({
    where: {
      isStale: false, flagged: false, availability: "in stock",
      tiers: { some: {} },
      product: { section: { notIn: ["grocery", "alcohol"] } },
    },
  });

  console.log(`\n\n════ THE PRODUCT METRIC — COMPARISON SECTIONS ONLY ══════════════════════════`);
  console.log(`  grocery + alcool: sections where more than one merchant sells the same thing.`);
  console.log(`  This is the number to track over time.\n`);
  console.log(`    comparable: ${cmp.comparable} of ${cmp.products}  ${pct(cmp.comparable, cmp.products)}`);

  console.log(`\n════ PRICE SECTIONS — COVERAGE, NOT COMPARABILITY ═══════════════════════════`);
  console.log(`  dcneu + cosmetice + farmacie: ONE merchant each, by construction. Nothing in`);
  console.log(`  them can ever be comparable, so reporting 0.0% frames a design decision as a`);
  console.log(`  failure. What matters here is how much is covered, priced and laddered.\n`);
  console.log(`    products:                      ${prc.products}`);
  console.log(`    with a showable price:         ${prc.withOffer}  ${pct(prc.withOffer, prc.products)}`);
  console.log(`    showable offers:               ${prc.offers}`);
  console.log(`    offers with a quantity ladder: ${prc.withTiers}  ${pct(prc.withTiers, prc.offers)}`);

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

  // ── CARRIED BY vs PRICED TODAY.
  //
  //    Out-of-stock dominates the loss, and that is not a pipeline failure — it is a fact
  //    about Romanian online grocery: Freshful and Sezamo run limited assortments, and the
  //    big online catalogs go out of stock constantly. So the honest framing is two numbers,
  //    not one. A product CARRIED by three shops and PRICED today at one is a useful page;
  //    reporting only the second understates what the site knows, and reporting only the
  //    first shows prices nobody can pay.
  const carried = (o: Row): boolean => hasPrice(o) && fresh(o) && unflagged(o);
  const carriedBy2 = products.filter((p) => merchants(p.offers as Row[], carried) >= 2).length;
  console.log(`\n  CARRIED BY 2+ SHOPS (in the catalog, fresh, not withheld — stock aside):`);
  console.log(`    ${carriedBy2}  (${pct(carriedBy2, products.length)})`);
  console.log(`  PRICED TODAY AT 2+ SHOPS (the shopper-facing number):`);
  const pricedToday = products.filter((p) => merchants(p.offers as Row[], all) >= 2).length;
  console.log(`    ${pricedToday}  (${pct(pricedToday, products.length)})`);
  console.log(`  The gap is products a shopper can still usefully compare, where at least one`);
  console.log(`  shop is out of stock today: ${carriedBy2 - pricedToday}`);

  // ── TOP CATEGORIES BY OUT-OF-STOCK SHARE. Where the loss actually lives.
  const byCat = new Map<string, { offers: number; oos: number }>();
  const cats = await prisma.product.findMany({
    where: { offers: { some: { merchant: { active: true } } } },
    select: { id: true, category: { select: { slug: true } } },
  });
  const catOf = new Map(cats.map((c) => [c.id, c.category?.slug ?? "(fara categorie)"]));
  for (const p of products) {
    const k = catOf.get(p.id) ?? "(fara categorie)";
    const e = byCat.get(k) ?? { offers: 0, oos: 0 };
    for (const o of p.offers as Row[]) {
      if (!hasPrice(o)) continue;
      e.offers++;
      if (!inStock(o)) e.oos++;
    }
    byCat.set(k, e);
  }
  console.log(`\n  TOP 20 CATEGORIES BY OUT-OF-STOCK SHARE (min 50 offers):`);
  console.log(`  ${pad("category", 26)}${lp("offers", 9)}${lp("out of stock", 14)}${lp("share", 9)}`);
  const ranked = [...byCat.entries()]
    .filter(([, e]) => e.offers >= 50)
    .sort((a, b) => b[1].oos / b[1].offers - a[1].oos / a[1].offers)
    .slice(0, 20);
  for (const [k, e] of ranked) {
    console.log(`  ${pad(k, 26)}${lp(e.offers, 9)}${lp(e.oos, 14)}${lp(pct(e.oos, e.offers), 9)}`);
  }

  // ── The headline a shopper sees on a single-merchant product is still a price we publish.
  const withAny = products.filter((p) => merchants(p.offers as Row[], all) >= 1).length;
  console.log(`\n  products with at least ONE showable price: ${withAny} (${pct(withAny, products.length)})`);
  console.log(`  products with NO showable price at all:    ${products.length - withAny}`);
  console.log(`\n  The second number is the one that matters for trust: a page with no current`);
  console.log(`  price must say so rather than show an old one.\n`);

  // The SPLIT figures, not the blended one. The blended number moves when the catalog's
  // composition changes, so a fortnight of it would record DCNeu's growth as a decline in
  // matching quality — which is precisely the reading the split exists to prevent.
  emitJson({
    comparison: {
      products: cmp.products,
      comparable: cmp.comparable,
      share: cmp.products === 0 ? 0 : Number(((cmp.comparable / cmp.products) * 100).toFixed(2)),
    },
    price: {
      products: prc.products,
      withOffer: prc.withOffer,
      offers: prc.offers,
      withTiers: prc.withTiers,
      pricedShare: prc.products === 0 ? 0 : Number(((prc.withOffer / prc.products) * 100).toFixed(2)),
      ladderShare: prc.offers === 0 ? 0 : Number(((prc.withTiers / prc.offers) * 100).toFixed(2)),
    },
    bySection: Object.fromEntries(
      [...bySection.entries()].map(([k, e]) => [k, { kind: sectionKind(k), total: e.total, comparable: e.comparable }]),
    ),
    lost: { outOfStock: lostStock, stale: lostFresh, flagged: lostFlag },
    carriedBy2Plus: carriedBy2,
    pricedTodayAt2Plus: pricedToday,
  });

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
