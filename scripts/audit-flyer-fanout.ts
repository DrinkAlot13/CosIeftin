// ── FULL-CATALOG DIFF FOR THE FLYER FAN-OUT RULE. READ-ONLY.
//
// The rule (scrape-util.ts, PASS 2 of matchPoolToCatalog) is a pure VETO: it can only move a
// pairing from confirmed to refused, never the reverse. So the exact set of pairs whose decision
// changes is computable directly from the LIVE data as it stands right now, with no re-scrape
// and no network: every group of live offers sharing one (merchant, storeName) that currently
// span 2+ DIFFERENT products is exactly what the old matcher confirmed and the new one would
// refuse if the rule applied to that merchant. This is the "measure the blast radius across the
// whole catalog" CLAUDE.md asks for, done without needing to replay a live scrape against two
// matcher versions.
//
// ── THE RULE IS SHIPPED SCOPED TO `storeType === "physical"` (today: Kaufland, Penny) ONLY.
//
// Measured here, not assumed: applying the veto to EVERY merchant hits 3,298 groups / 7,155
// offers and would take grocery comparability from 11.4% to 5.8%. A large share of that is NOT
// the flyer defect — it is PRE-EXISTING CATALOG DUPLICATE ROWS (the same product entered twice
// under different ids, e.g. "Suc de mere Ana Are, 3 l" as both #1906 and #38584), which this
// rule cannot tell apart from genuine variant ambiguity, because from `decide()`'s point of view
// both look identical: "2+ candidates cleared for one store item". So this reports BOTH scopes —
// what is actually applied (physical merchants), and the wider catalog-wide number as a SEPARATE
// finding for a deliberate decision, never silently folded into one number.
//
// Reports, per CLAUDE.md's peer-relative-check rule: the GROUP, never a named culprit.
//
//   npm run audit:flyer-fanout

import { PrismaClient } from "@prisma/client";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();

type OfferRow = { id: number; storeName: string | null; priceBani: number | null; price: number; merchant: { id: number; slug: string; name: string; storeType: string }; product: { id: number; name: string } };

function groupByStoreItem(offers: OfferRow[]) {
  const byKey = new Map<string, { merchantSlug: string; merchantName: string; storeName: string; rows: OfferRow[] }>();
  for (const o of offers) {
    const key = `${o.merchant.id}::${o.storeName}`;
    const g = byKey.get(key) ?? { merchantSlug: o.merchant.slug, merchantName: o.merchant.name, storeName: o.storeName!, rows: [] };
    g.rows.push(o);
    byKey.set(key, g);
  }
  return [...byKey.values()].filter((g) => new Set(g.rows.map((r) => r.product.id)).size > 1);
}

/** True when every candidate in the group shares one exact (trimmed, lowercased) product name —
 *  i.e. this is very likely a catalog-duplicate-row problem, not a genuine variant ambiguity. */
function looksLikeDuplicateRows(g: { rows: OfferRow[] }): boolean {
  const names = [...new Map(g.rows.map((r) => [r.product.id, r.product.name])).values()].map((n) => n.trim().toLowerCase());
  return names.every((n) => n === names[0]);
}

async function comparabilityWith(withheldOfferIds: Set<number>) {
  const live = { merchant: { active: true }, isStale: false, flagged: false };
  const products = await prisma.product.findMany({
    where: { section: { in: ["grocery", "alcohol"] }, offers: { some: live } },
    select: { offers: { where: live, select: { id: true, merchantId: true } } },
  });
  const before = products.filter((pr) => new Set(pr.offers.map((o) => o.merchantId)).size >= 2).length;
  const after = products.filter((pr) => {
    const remaining = pr.offers.filter((o) => !withheldOfferIds.has(o.id));
    return new Set(remaining.map((o) => o.merchantId)).size >= 2;
  }).length;
  return { total: products.length, before, after };
}

async function main(): Promise<void> {
  const offers = (await prisma.offer.findMany({
    where: { isStale: false, flagged: false, storeName: { not: null } },
    select: {
      id: true, storeName: true, priceBani: true, price: true,
      merchant: { select: { id: true, slug: true, name: true, storeType: true } },
      product: { select: { id: true, name: true } },
    },
  })) as OfferRow[];

  const allGroups = groupByStoreItem(offers);
  const physicalGroups = allGroups.filter((g) => offers.find((o) => o.merchant.slug === g.merchantSlug)?.merchant.storeType === "physical");

  const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) : "—");

  console.log("═".repeat(100));
  console.log("  FLYER FAN-OUT — FULL-CATALOG DIFF");
  console.log("═".repeat(100));
  console.log(`  live offers scanned: ${offers.length}`);

  // ── 1. AS SHIPPED: storeType === "physical" only ──────────────────────────────────────────
  const physicalOffersWithheld = new Set(physicalGroups.flatMap((g) => g.rows.map((r) => r.id)));
  const compPhysical = await comparabilityWith(physicalOffersWithheld);
  console.log(`\n${"─".repeat(96)}`);
  console.log(`  1. AS SHIPPED — scoped to storeType="physical" (Kaufland, Penny)`);
  console.log("─".repeat(96));
  console.log(`  groups: ${physicalGroups.length}   offers withheld: ${physicalOffersWithheld.size}`);
  console.log(`  grocery+alcohol comparable (2+ shops): ${compPhysical.before} -> ${compPhysical.after} of ${compPhysical.total}  (${compPhysical.after - compPhysical.before >= 0 ? "+" : ""}${compPhysical.after - compPhysical.before})`);
  for (const g of physicalGroups) {
    const price = g.rows[0].priceBani != null ? `${(g.rows[0].priceBani / 100).toFixed(2)} lei` : `${g.rows[0].price} lei`;
    console.log(`\n  [${g.merchantName}] "${g.storeName}" (${price}) -> ${g.rows.length} products`);
    for (const r of g.rows) console.log(`      #${r.product.id}  "${r.product.name.slice(0, 60)}"`);
  }

  // ── 2. CATALOG-WIDE: informational only, NOT applied ──────────────────────────────────────
  const dupGroups = allGroups.filter(looksLikeDuplicateRows);
  const genuineGroups = allGroups.filter((g) => !looksLikeDuplicateRows(g));
  const allOffersWithheld = new Set(allGroups.flatMap((g) => g.rows.map((r) => r.id)));
  const compAll = await comparabilityWith(allOffersWithheld);

  console.log(`\n${"─".repeat(96)}`);
  console.log(`  2. CATALOG-WIDE, IF APPLIED TO EVERY MERCHANT — NOT SHIPPED, informational only`);
  console.log("─".repeat(96));
  console.log(`  total groups: ${allGroups.length}   offers withheld: ${allOffersWithheld.size}`);
  console.log(`  grocery+alcohol comparable (2+ shops): ${compAll.before} -> ${compAll.after} of ${compAll.total}  (${compAll.after - compAll.before})`);
  console.log(`\n  Split by likely cause — this audit CANNOT tell them apart precisely, only flag the`);
  console.log(`  mechanical signature (do ALL matched products share one exact name?):`);
  console.log(`    likely CATALOG DUPLICATES (exact same name, 2+ ids):   ${dupGroups.length} groups`);
  console.log(`    likely GENUINE fan-out (matched names differ):         ${genuineGroups.length} groups`);
  console.log(`  The genuine bucket still mixes true ambiguity (Nivea/Lay's/Dove-shaped) with`);
  console.log(`  near-duplicates that merely differ in phrasing — read the printed groups.`);

  const byMerchant = new Map<string, { groups: number; offers: number }>();
  for (const g of allGroups) {
    const m = byMerchant.get(g.merchantSlug) ?? { groups: 0, offers: 0 };
    m.groups++;
    m.offers += g.rows.length;
    byMerchant.set(g.merchantSlug, m);
  }
  console.log(`\n  BY MERCHANT (catalog-wide count, for scale — not all of this is shipped):`);
  for (const [slug, m] of [...byMerchant.entries()].sort((a, b) => b[1].offers - a[1].offers)) {
    console.log(`    ${slug.padEnd(18)} groups=${String(m.groups).padStart(4)}  offers withheld=${String(m.offers).padStart(4)}`);
  }

  emitJson({
    pass: true,
    liveOffersScanned: offers.length,
    shipped: { groups: physicalGroups.length, offersWithheld: physicalOffersWithheld.size, comparabilityBefore: compPhysical.before, comparabilityAfter: compPhysical.after },
    catalogWide: {
      groups: allGroups.length, offersWithheld: allOffersWithheld.size,
      comparabilityBefore: compAll.before, comparabilityAfter: compAll.after,
      likelyDuplicateGroups: dupGroups.length, likelyGenuineGroups: genuineGroups.length,
      byMerchant: Object.fromEntries(byMerchant),
    },
    shippedGroups: physicalGroups.map((g) => ({ merchant: g.merchantSlug, storeName: g.storeName, products: g.rows.map((r) => ({ id: r.product.id, name: r.product.name })) })),
  });
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
