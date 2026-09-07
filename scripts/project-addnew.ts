// ── SCOPE: REPORT ONLY. Writes nothing, changes nothing.
//
// WHAT TURNING ON `addNew` WOULD DO, before it is turned on.
//
// Carrefour, Mega Image and Freshful run match-only: they attach prices to products the catalog
// already carries and discard the rest. Mega Image pools 7,224 distinct products a night and
// writes about 741. Letting them create products raises the counters — and the question this
// script exists to answer is what it does to the number that actually matters, which is how
// many products a shopper can COMPARE.
//
// ── THE TRADE, STATED AS ARITHMETIC.
//
// Every product created by `addNew` starts life with exactly one offer, from the merchant that
// created it. So a catalog that grows by N products grows its single-shop population by N,
// unless a LATER merchant matches onto the same product. That "unless" is the whole question,
// and it cannot be answered by adding up pool sizes.
//
// So this reports a RANGE:
//
//   pessimistic — every new product stays single-shop. The ceiling on the damage.
//   optimistic  — every name that appears in two merchants' unmatched pools becomes one
//                 two-shop product. The floor, and it is optimistic because two products
//                 sharing a normalised name signature are not necessarily the same product;
//                 the matcher would still have to agree, and its rules are stricter than this.
//
// The truth is between them, and the brief's answer is to measure after each merchant rather
// than trust either end.
//
// Reads the pool dumps written by `POOL_ONLY=1 npm run scrape:<merchant>`.
//
// Run: npm run project:addnew

import { PrismaClient } from "@prisma/client";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { normalizeRo } from "../src/lib/text/normalizeRo";
import { parseSize } from "../src/lib/ingest-core";
import { duplicateKey } from "../src/lib/duplicate-key";

const prisma = new PrismaClient();
const DIR = process.env.POOL_OUT_DIR ?? "tmp-pools";

/** The order the brief prescribes: biggest pool first, so the worst case shows up soonest. */
const MERCHANTS = ["mega-image", "carrefour", "freshful"] as const;

type PoolItem = { name: string; brand: string; url: string; price: number; sourceId?: string | null };

const MAX_DISPLAY_AGE_DAYS = 14;
const lp = (s: string | number, n: number): string => String(s).padStart(n);
const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const pct = (a: number, b: number): string => (b === 0 ? "  —  " : `${((a / b) * 100).toFixed(1)}%`);

/**
 * The key a product created by `addNew` would land on.
 *
 * `addNew` sets `unit`/`unitSize` from `parseSize(name)` — falling back to buc/1 — so this
 * mirrors that exactly, then asks the SAME question `audit:duplicates` asks. Using a different
 * key here would make "280 new duplicate groups" and "648 existing duplicate groups" two
 * different measurements, and the brief's 200-group stop condition uncheckable against either.
 */
function keyForPoolItem(item: PoolItem, section = "grocery"): string {
  const size = parseSize(item.name);
  return duplicateKey({
    section,
    name: item.name,
    unit: size?.unit ?? "buc",
    unitSize: size?.unitSize ?? 1,
  });
}

async function main(): Promise<void> {
  console.log(`\n════ PROJECTION: WHAT addNew WOULD DO ═══════════════════════════════════════`);
  console.log(`  Read-only. Nothing here writes, and the pools were dumped without writing.\n`);

  // ── Where we stand now, computed here so before and after use ONE definition.
  const live = {
    merchant: { active: true },
    availability: "in stock",
    isStale: false,
    NOT: { priceSource: "DELIVERY_PLATFORM" },
    flagged: false,
    lastObservedAt: { gte: new Date(Date.now() - MAX_DISPLAY_AGE_DAYS * 86_400_000) },
  } as const;

  const groceryOffers = await prisma.offer.groupBy({
    by: ["productId"],
    where: { ...live, product: { section: "grocery" } },
    _count: { _all: true },
  });
  const depthNow = new Map(groceryOffers.map((r) => [r.productId, r._count._all]));
  const pricedNow = depthNow.size;
  const singleNow = [...depthNow.values()].filter((n) => n === 1).length;

  console.log(`  TODAY (grocery, products with a price a shopper can act on)`);
  console.log(`    products with a live price      ${lp(pricedNow, 7)}`);
  console.log(`    of which exactly ONE shop       ${lp(singleNow, 7)}   ${pct(singleNow, pricedNow)}  ← the number that must not get worse`);
  console.log(`    two or more shops               ${lp(pricedNow - singleNow, 7)}   ${pct(pricedNow - singleNow, pricedNow)}`);

  // ── Existing catalog identity, so a pool item can be told from a product we already carry.
  const catalog = await prisma.product.findMany({
    where: { section: "grocery" },
    select: { id: true, name: true, brand: true, unit: true, unitSize: true },
  });
  const catalogSigs = new Set(catalog.map((c) => duplicateKey({ ...c, section: "grocery" })));

  // ── Which pool items already have an offer from that merchant (so addNew would not touch them).
  type Loaded = { slug: string; pool: PoolItem[]; unmatched: PoolItem[] };
  const loaded: Loaded[] = [];
  for (const slug of MERCHANTS) {
    const file = join(DIR, `${slug}-pool.json`);
    if (!existsSync(file)) {
      console.log(`\n  ⚠ no pool dump for ${slug} at ${file} — run POOL_ONLY=1 npm run scrape:<merchant>`);
      continue;
    }
    const pool = JSON.parse(readFileSync(file, "utf8")) as PoolItem[];
    const m = await prisma.merchant.findUnique({ where: { slug }, select: { id: true } });
    const offers = await prisma.offer.findMany({ where: { merchantId: m!.id }, select: { url: true } });
    const have = new Set(offers.map((o) => o.url));
    loaded.push({ slug, pool, unmatched: pool.filter((p) => !have.has(p.url)) });
  }

  if (loaded.length === 0) {
    console.log(`\n  No pool dumps found. Nothing to project.\n`);
    await prisma.$disconnect();
    return;
  }

  console.log(`\n  PER MERCHANT — what addNew would create`);
  console.log(`  ${pad("merchant", 14)} ${lp("pooled", 8)} ${lp("already", 8)} ${lp("would be", 9)} ${lp("of those, a", 12)} ${lp("genuinely", 10)}`);
  console.log(`  ${pad("", 14)} ${lp("", 8)} ${lp("priced", 8)} ${lp("NEW", 9)} ${lp("catalog dupe", 12)} ${lp("new", 10)}`);
  console.log(`  ${"-".repeat(70)}`);

  let totalNew = 0;
  const seenAcross = new Map<string, string[]>();
  for (const l of loaded) {
    const sigs = l.unmatched.map((u) => keyForPoolItem(u));
    // A pool item whose signature already exists in the catalog is a DUPLICATE waiting to
    // happen — addNew would create a second row for a product we already carry. That is the
    // failure mode the brief names, and it is countable before anything runs.
    const dupes = sigs.filter((s) => catalogSigs.has(s)).length;
    const fresh = sigs.length - dupes;
    totalNew += fresh;
    for (const s of sigs) {
      const list = seenAcross.get(s) ?? [];
      if (!list.includes(l.slug)) list.push(l.slug);
      seenAcross.set(s, list);
    }
    console.log(
      `  ${pad(l.slug, 14)} ${lp(l.pool.length, 8)} ${lp(l.pool.length - l.unmatched.length, 8)} ` +
      `${lp(l.unmatched.length, 9)} ${lp(dupes, 12)} ${lp(fresh, 10)}`,
    );
  }

  // ── How many of the new products two of the three merchants would BOTH bring.
  const shared = [...seenAcross.values()].filter((ms) => ms.length >= 2).length;

  console.log(`\n  CROSS-MERCHANT OVERLAP`);
  console.log(`    signatures appearing in 2+ of the three pools  ${lp(shared, 7)}`);
  console.log(`    (an upper bound: a shared signature is not a match, and the matcher is stricter)`);

  // ── The two ends of the range, CUMULATIVELY, in the order the brief prescribes.
  //
  // The stop condition is per merchant, so the whole-set number is not the one that decides
  // anything: what matters is which STEP crosses the line, because that is where work stops.
  console.log(`
  PROJECTED GROCERY COMPARABILITY, CUMULATIVE, IN ORDER`);
  console.log(`  ${pad("after", 22)} ${lp("priced", 9)} ${lp("single-shop", 12)} ${lp("share", 8)}  verdict`);
  console.log(`  ${"-".repeat(74)}`);
  console.log(`  ${pad("today", 22)} ${lp(pricedNow, 9)} ${lp(singleNow, 12)} ${lp(pct(singleNow, pricedNow), 8)}`);

  const STOP_SHARE = 93;
  const STOP_DUPES = 200;
  let runningPriced = pricedNow;
  let runningSingle = singleNow;
  let firstBreach: string | null = null;
  for (const l of loaded) {
    const sigs = l.unmatched.map((u) => keyForPoolItem(u));
    const dupes = sigs.filter((x) => catalogSigs.has(x)).length;
    const fresh = sigs.length - dupes;
    runningPriced += fresh;
    runningSingle += fresh;
    const share = (runningSingle / runningPriced) * 100;
    const breaches: string[] = [];
    if (share > STOP_SHARE) breaches.push(`single-shop ${share.toFixed(1)}% > ${STOP_SHARE}%`);
    if (dupes > STOP_DUPES) breaches.push(`${dupes} duplicate groups > ${STOP_DUPES}`);
    if (breaches.length && !firstBreach) firstBreach = l.slug;
    console.log(
      `  ${pad("+ " + l.slug, 22)} ${lp(runningPriced, 9)} ${lp(runningSingle, 12)} ${lp(share.toFixed(1) + "%", 8)}  ` +
      `${breaches.length ? "✗ " + breaches.join("; ") : "✓ within both limits"}`,
    );
  }

  console.log(`
  STOP CONDITIONS: single-shop share above ${STOP_SHARE}%, or more than ${STOP_DUPES} new duplicate groups.`);
  console.log(`  Duplicate groups are counted with the SAME key as audit:duplicates (currently 648 groups),`);
  console.log(`  so "new groups" and "existing groups" are the same measurement.`);
  if (firstBreach) {
    console.log(`
  ⚠ PROJECTED TO BREACH AT: ${firstBreach}. The brief says stop there and report,`);
    console.log(`    so the plan is to run the merchants before it and stop.`);
  } else {
    console.log(`
  ✓ no step is projected to breach either limit.`);
  }

  // ── The pinned basket, which is the other number the brief wants projected.
  console.log(`\n  THE PINNED BASKET is unaffected by this change: its forty lines are existing`);
  console.log(`  catalog products and classes, and addNew creates products none of them name.`);
  console.log(`  Measured after each merchant anyway — a projection is not a measurement.\n`);

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
