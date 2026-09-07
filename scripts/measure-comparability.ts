// ── SCOPE: REPORT ONLY. One measurement, run before and after each change.
//
// The brief's gate for turning `addNew` on: after each merchant, report the single-shop share,
// the pinned basket, and the duplicate-group count, and stop if a limit is crossed.
//
// It is ONE script run repeatedly rather than a "before" and an "after" script, because two
// scripts is two definitions and the whole point is a difference. Append-only: every run writes
// a line to logs/comparability.jsonl so the sequence can be read afterwards without trusting
// anyone's notes.
//
// Run: npm run measure:comparability -- --label "after mega-image addNew"

import { PrismaClient } from "@prisma/client";
import { appendFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { INDEX_BASKET_V2 } from "../src/lib/index-basket-v2";
import { duplicateKey } from "../src/lib/duplicate-key";

const prisma = new PrismaClient();
const MAX_DISPLAY_AGE_DAYS = 14;
const LOG = "logs/comparability.jsonl";

/** The brief's stop conditions. */
const STOP_SINGLE_SHOP_PCT = 93;
const STOP_NEW_DUPE_GROUPS = 200;

const lp = (s: string | number, n: number): string => String(s).padStart(n);
const pct = (a: number, b: number): number => (b === 0 ? 0 : (a / b) * 100);

async function main(): Promise<void> {
  const labelIdx = process.argv.indexOf("--label");
  const label = labelIdx > -1 ? process.argv[labelIdx + 1] ?? "unlabelled" : "unlabelled";

  const live = {
    merchant: { active: true },
    availability: "in stock",
    isStale: false,
    NOT: { priceSource: "DELIVERY_PLATFORM" },
    flagged: false,
    lastObservedAt: { gte: new Date(Date.now() - MAX_DISPLAY_AGE_DAYS * 86_400_000) },
  } as const;

  // ── Grocery depth.
  const rows = await prisma.offer.groupBy({
    by: ["productId"],
    where: { ...live, product: { section: "grocery" } },
    _count: { _all: true },
  });
  const priced = rows.length;
  const single = rows.filter((r) => r._count._all === 1).length;
  const multi = priced - single;

  // ── The pinned basket, by class: how many of the forty lines two or more shops can price.
  const classes = await prisma.equivalenceClass.findMany({
    where: { slug: { in: INDEX_BASKET_V2.map((i) => i.classSlug) } },
    select: { id: true, slug: true },
  });
  const classIds = new Set(classes.map((c) => c.id));
  const basketOffers = await prisma.offer.findMany({
    where: { ...live, product: { equivalenceClassId: { in: [...classIds] } } },
    select: { merchantId: true, product: { select: { equivalenceClassId: true } } },
  });
  const shopsPerClass = new Map<number, Set<number>>();
  for (const o of basketOffers) {
    const cid = o.product.equivalenceClassId!;
    const s = shopsPerClass.get(cid) ?? new Set<number>();
    s.add(o.merchantId);
    shopsPerClass.set(cid, s);
  }
  const basketLines = INDEX_BASKET_V2.length;
  const basketFilled = [...shopsPerClass.values()].filter((s) => s.size >= 1).length;
  const basketMulti = [...shopsPerClass.values()].filter((s) => s.size >= 2).length;

  // ── Duplicate groups, the SAME key `audit:duplicates` uses — but GROCERY ONLY.
  //
  // `audit:duplicates` counts every section and reports 648. This counts grocery and reports
  // 150. Both are right and they must never be compared: `addNew` for these three merchants
  // creates grocery products only, so grocery is the population the stop condition is about.
  // Printing an unlabelled "150" beside a remembered "648" would read as a 498-group
  // improvement that never happened — the same shape as summing fourteen nights against one.
  const products = await prisma.product.findMany({
    where: { section: "grocery" },
    select: { name: true, section: true, unit: true, unitSize: true },
  });
  const allSectionProducts = await prisma.product.count();
  const groups = new Map<string, number>();
  for (const p of products) {
    const k = duplicateKey(p);
    groups.set(k, (groups.get(k) ?? 0) + 1);
  }
  const dupeGroups = [...groups.values()].filter((n) => n > 1).length;

  const totalProducts = products.length;
  const singlePct = pct(single, priced);
  const basketMultiPct = pct(basketMulti, basketLines);

  console.log(`\n════ COMPARABILITY — ${label} ═══════════════════════════════════════════`);
  console.log(`  grocery products in catalog        ${lp(totalProducts, 8)}`);
  console.log(`  …with a live price                 ${lp(priced, 8)}`);
  console.log(`    exactly one shop                 ${lp(single, 8)}   ${singlePct.toFixed(1)}%`);
  console.log(`    two or more shops                ${lp(multi, 8)}   ${pct(multi, priced).toFixed(1)}%`);
  console.log(`  pinned basket (${basketLines} lines)`);
  console.log(`    at least one shop                ${lp(basketFilled, 8)}   ${pct(basketFilled, basketLines).toFixed(1)}%`);
  console.log(`    two or more shops                ${lp(basketMulti, 8)}   ${basketMultiPct.toFixed(1)}%`);
  console.log(`  duplicate groups, GROCERY ONLY                  ${lp(dupeGroups, 6)}`);
  console.log(`    (audit:duplicates counts all ${allSectionProducts} products across every section and reports a`);
  console.log(`     larger number. Same key, different population — do not compare the two.)`);

  // ── Compare with the previous run, so the delta is on screen and not in someone's head.
  let previous: Record<string, number> | null = null;
  if (existsSync(LOG)) {
    const lines = readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean);
    if (lines.length) previous = JSON.parse(lines[lines.length - 1]) as Record<string, number>;
  }
  if (previous) {
    const d = (now: number, was: unknown): string => {
      const w = typeof was === "number" ? was : 0;
      const diff = now - w;
      return `${diff >= 0 ? "+" : ""}${diff}`;
    };
    console.log(`\n  SINCE "${(previous as unknown as { label: string }).label}"`);
    console.log(`    products       ${d(totalProducts, previous.totalProducts)}`);
    console.log(`    priced         ${d(priced, previous.priced)}`);
    console.log(`    single-shop    ${d(single, previous.single)}   share ${(singlePct - (previous.singlePct ?? 0)).toFixed(1)} pts`);
    console.log(`    2+ shops       ${d(multi, previous.multi)}`);
    console.log(`    duplicate grps ${d(dupeGroups, previous.dupeGroups)}   ← the brief's limit is +${STOP_NEW_DUPE_GROUPS}`);

    const newDupes = dupeGroups - (previous.dupeGroups ?? 0);
    const breaches: string[] = [];
    if (singlePct > STOP_SINGLE_SHOP_PCT) breaches.push(`single-shop ${singlePct.toFixed(1)}% > ${STOP_SINGLE_SHOP_PCT}%`);
    if (newDupes > STOP_NEW_DUPE_GROUPS) breaches.push(`${newDupes} new duplicate groups > ${STOP_NEW_DUPE_GROUPS}`);
    console.log(`\n  ${breaches.length ? "✗ STOP CONDITION HIT: " + breaches.join("; ") : "✓ within both stop conditions"}`);
  } else {
    console.log(`\n  (no previous measurement — this is the baseline)`);
  }

  mkdirSync("logs", { recursive: true });
  appendFileSync(LOG, JSON.stringify({
    at: new Date().toISOString(), label,
    totalProducts, priced, single, multi, singlePct: Number(singlePct.toFixed(2)),
    basketFilled, basketMulti, basketMultiPct: Number(basketMultiPct.toFixed(2)),
    dupeGroups,
  }) + "\n", "utf8");
  console.log(`\n  appended to ${LOG}\n`);

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
