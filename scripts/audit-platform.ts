// ── WHAT DO THE DELIVERY-PLATFORM PRICES ACTUALLY COST, AND WHAT DO THEY BUY? READ-ONLY.
//
// Kaufland, Penny and Profi are ingested through Glovo and hidden by default (see
// `lib/platform/visibility`). Phase 3 makes them visible and labelled. Before that, four numbers,
// because "+577 comparisons" is not one thing:
//
//   1. THE MARKUP, per merchant, against the SAME PRODUCT's shelf price at a shelf merchant.
//      Reported as a distribution, not a mean: a median of 11.6% with a long tail is a different
//      product from a flat 11.6%.
//   2. HOW MANY MATCH SHELF PRICE EXACTLY. If a quarter of the assortment is at shelf price, the
//      label "include adaosul platformei" is wrong for those rows and must not imply otherwise.
//   3. PRICELESS PRODUCTS — in stock somewhere, but ONLY at a platform, so the site currently
//      shows no price at all. Nobody has counted these and they are pure gain from visibility.
//   4. CLASSES THAT GAIN A MERCHANT purely from platform prices becoming visible. That separates
//      real cross-shop comparison from platform-only comparison, which a shopper must be able to
//      tell apart.
//
// It writes nothing and changes no flag.
//
//   npm run audit:platform

import { PrismaClient } from "@prisma/client";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();
const PLATFORM = "DELIVERY_PLATFORM";

const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) : "—");
const lei = (b: number) => (b / 100).toFixed(2);

function quantiles(xs: number[]): { p10: number; p25: number; median: number; p75: number; p90: number } {
  const s = [...xs].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))];
  return { p10: at(0.1), p25: at(0.25), median: at(0.5), p75: at(0.75), p90: at(0.9) };
}

async function main(): Promise<void> {
  // "Live" here deliberately does NOT exclude platform rows — that is the thing being measured.
  const live = { isStale: false, flagged: false, merchant: { active: true } };

  const products = await prisma.product.findMany({
    where: { section: "grocery", offers: { some: live } },
    select: {
      id: true, name: true, equivalenceClassId: true,
      offers: {
        where: live,
        select: {
          priceBani: true, price: true, priceSource: true, availability: true,
          merchant: { select: { slug: true, name: true } },
        },
      },
    },
  });
  if (products.length === 0) {
    console.error("No live grocery products. Checked nothing — a FAILURE, not a pass.");
    emitJson({ pass: false, reason: "no-population" });
    await prisma.$disconnect();
    process.exit(1);
  }

  const bani = (o: { priceBani: number | null; price: number }) => o.priceBani ?? Math.round(o.price * 100);
  const inStock = (o: { availability: string }) => o.availability === "in stock";
  const isPlat = (o: { priceSource: string | null }) => (o.priceSource ?? "") === PLATFORM;

  // ── 1 + 2. MARKUP, per platform merchant, against the same product's shelf price ───────────
  const marks = new Map<string, number[]>();
  const exact = new Map<string, number>();
  const cheaper = new Map<string, number>();
  for (const p of products) {
    const shelf = p.offers.filter((o) => !isPlat(o) && inStock(o));
    if (shelf.length === 0) continue;
    const shelfLow = Math.min(...shelf.map(bani));
    if (shelfLow <= 0) continue;
    for (const o of p.offers.filter((x) => isPlat(x) && inStock(x))) {
      const v = bani(o);
      if (v <= 0) continue;
      const slug = o.merchant.slug;
      const m = (v - shelfLow) / shelfLow;
      marks.set(slug, [...(marks.get(slug) ?? []), m]);
      if (v === shelfLow) exact.set(slug, (exact.get(slug) ?? 0) + 1);
      if (v < shelfLow) cheaper.set(slug, (cheaper.get(slug) ?? 0) + 1);
    }
  }

  console.log("═".repeat(104));
  console.log("  DELIVERY-PLATFORM PRICES — what they cost and what they buy");
  console.log("═".repeat(104));
  console.log("\n  1+2. MARKUP against the same product's cheapest SHELF price, in stock both sides");
  console.log(`  ${"merchant".padEnd(18)}${"compared".padStart(9)}${"p10".padStart(8)}${"p25".padStart(8)}${"median".padStart(9)}${"p75".padStart(8)}${"p90".padStart(8)}${"= shelf".padStart(10)}${"cheaper".padStart(9)}`);
  console.log("  " + "─".repeat(96));
  const markupRows: Record<string, unknown>[] = [];
  for (const [slug, xs] of [...marks].sort((a, b) => b[1].length - a[1].length)) {
    const q = quantiles(xs);
    const e = exact.get(slug) ?? 0;
    const c = cheaper.get(slug) ?? 0;
    console.log(
      `  ${slug.padEnd(18)}${String(xs.length).padStart(9)}` +
      `${`${(q.p10 * 100).toFixed(1)}%`.padStart(8)}${`${(q.p25 * 100).toFixed(1)}%`.padStart(8)}` +
      `${`${(q.median * 100).toFixed(1)}%`.padStart(9)}${`${(q.p75 * 100).toFixed(1)}%`.padStart(8)}` +
      `${`${(q.p90 * 100).toFixed(1)}%`.padStart(8)}` +
      `${`${e} (${pct(e, xs.length)}%)`.padStart(10)}${`${c}`.padStart(9)}`,
    );
    markupRows.push({ merchant: slug, compared: xs.length, ...q, exact: e, cheaper: c });
  }
  console.log(`\n  "= shelf" is an EXACT match to the cheapest shelf price. For those rows the label`);
  console.log(`  "include adaosul platformei" would be false, so the UI must not assert a markup it`);
  console.log(`  has not measured on that row — it says the price comes THROUGH the platform.`);

  // ── 3. PRICELESS PRODUCTS ──────────────────────────────────────────────────────────────────
  let priceless = 0;
  let pricelessWithShelfStale = 0;
  const pricelessByMerchant = new Map<string, number>();
  const examples: string[] = [];
  for (const p of products) {
    const stockShelf = p.offers.filter((o) => !isPlat(o) && inStock(o));
    const stockPlat = p.offers.filter((o) => isPlat(o) && inStock(o));
    if (stockShelf.length > 0 || stockPlat.length === 0) continue;
    priceless++;
    if (p.offers.some((o) => !isPlat(o))) pricelessWithShelfStale++;
    for (const s of new Set(stockPlat.map((o) => o.merchant.slug))) {
      pricelessByMerchant.set(s, (pricelessByMerchant.get(s) ?? 0) + 1);
    }
    if (examples.length < 10) {
      examples.push(`${p.name.slice(0, 54).padEnd(55)}${stockPlat.map((o) => `${o.merchant.slug} ${lei(bani(o))}`).join(" · ")}`);
    }
  }
  console.log(`\n${"─".repeat(104)}`);
  console.log(`  3. PRICELESS TODAY — in stock, but ONLY at a platform, so the site shows no price`);
  console.log("─".repeat(104));
  console.log(`  ${priceless} products (${pct(priceless, products.length)}% of live grocery)`);
  console.log(`     of which ${pricelessWithShelfStale} also have a shelf offer that is out of stock or stale`);
  for (const [s, n] of [...pricelessByMerchant].sort((a, b) => b[1] - a[1])) console.log(`     ${s.padEnd(18)}${String(n).padStart(6)}`);
  console.log(`\n  examples:`);
  for (const e of examples) console.log(`    ${e}`);

  // ── 4. WHAT VISIBILITY BUYS, split into two DIFFERENT things ───────────────────────────────
  const merchOf = (p: (typeof products)[number], withPlatform: boolean) =>
    new Set(p.offers.filter((o) => inStock(o) && (withPlatform || !isPlat(o))).map((o) => o.merchant.slug));

  let compOff = 0, compOn = 0, gainedMixed = 0, gainedPlatformOnly = 0;
  for (const p of products) {
    const off = merchOf(p, false);
    const on = merchOf(p, true);
    if (off.size >= 2) compOff++;
    if (on.size >= 2) compOn++;
    if (off.size < 2 && on.size >= 2) {
      // Did it become comparable across a SHELF and a platform (a real cross-shop comparison a
      // shopper can act on), or only between two platform storefronts?
      const shelfCount = [...on].filter((s) => !s.startsWith("glovo")).length;
      if (shelfCount >= 1) gainedMixed++;
      else gainedPlatformOnly++;
    }
  }

  // classes that gain a merchant purely from platform visibility
  const byClassOff = new Map<number, Set<string>>();
  const byClassOn = new Map<number, Set<string>>();
  for (const p of products) {
    if (p.equivalenceClassId == null) continue;
    const a = byClassOff.get(p.equivalenceClassId) ?? new Set<string>();
    for (const s of merchOf(p, false)) a.add(s);
    byClassOff.set(p.equivalenceClassId, a);
    const b = byClassOn.get(p.equivalenceClassId) ?? new Set<string>();
    for (const s of merchOf(p, true)) b.add(s);
    byClassOn.set(p.equivalenceClassId, b);
  }
  let classesResolvingOff = 0, classesResolvingOn = 0;
  const gainedClasses: string[] = [];
  for (const [id, on] of byClassOn) {
    const off = byClassOff.get(id) ?? new Set<string>();
    if (off.size >= 2) classesResolvingOff++;
    if (on.size >= 2) classesResolvingOn++;
    if (off.size < 2 && on.size >= 2) gainedClasses.push(String(id));
  }
  const slugs = await prisma.equivalenceClass.findMany({
    where: { id: { in: gainedClasses.map(Number) } }, select: { slug: true },
  });

  console.log(`\n${"─".repeat(104)}`);
  console.log(`  4. WHAT VISIBILITY BUYS — and it is two different things`);
  console.log("─".repeat(104));
  console.log(`  products comparable at 2+ merchants, platform HIDDEN:  ${compOff}`);
  console.log(`  products comparable at 2+ merchants, platform SHOWN:   ${compOn}   (+${compOn - compOff})`);
  console.log();
  console.log(`     of the gain, SHELF + PLATFORM (a real cross-shop comparison):  ${gainedMixed}`);
  console.log(`     of the gain, PLATFORM ONLY  (two Glovo storefronts, same markup): ${gainedPlatformOnly}`);
  console.log(`\n  Those are not the same product. A shopper comparing Kaufland-via-Glovo with`);
  console.log(`  Penny-via-Glovo is comparing two marked-up prices, and the site must not present`);
  console.log(`  that as evidence about the shelf price at either shop.`);
  console.log();
  console.log(`  equivalence classes resolving at 2+ merchants, platform HIDDEN: ${classesResolvingOff}`);
  console.log(`  equivalence classes resolving at 2+ merchants, platform SHOWN:  ${classesResolvingOn}   (+${classesResolvingOn - classesResolvingOff})`);
  if (slugs.length) console.log(`     gained: ${slugs.map((s) => s.slug).join(", ")}`);
  console.log("═".repeat(104));

  emitJson({
    pass: true, liveGrocery: products.length,
    markup: markupRows,
    priceless, pricelessWithShelfStale, pricelessByMerchant: Object.fromEntries(pricelessByMerchant),
    comparableOff: compOff, comparableOn: compOn, gainedMixed, gainedPlatformOnly,
    classesResolvingOff, classesResolvingOn, gainedClasses: slugs.map((s) => s.slug),
  });
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
