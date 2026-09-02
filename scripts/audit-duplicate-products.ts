// ── SCOPE: DATA INTEGRITY ─────────────────────────────────────────────────────
// The same product filed under two catalog entries.
//
// A duplicate is not a cosmetic problem. It SPLITS THE PEER GROUP: each entry carries some of
// the merchants, so neither can compare across all of them, and every peer-relative check —
// median deviation, unit-price spread — runs on half the evidence. When one merchant appears on
// BOTH entries, its own two rows cannot even be compared with each other. That is comparability
// actively lost, which is why the severe kind is counted separately.
//
// DETECTION: word-order-independent token bag plus identical unit and size. That is a good
// DETECTOR and a dangerous MERGER — "Lapte 1,5% 1 l" and "Lapte 1 l 1,5%" share a bag, and so
// would two genuinely different variants whose distinguishing word happens to be noise-listed.
// Nothing here merges anything.
//
// It also asks the question that decides whether the review is worth an evening: does
// `matchDecision` — the live matcher — already accept these pairs? If it does, the duplicates
// are historical and stop accumulating; if it rejects them, this is a matcher gap and fixing it
// upstream beats reviewing 645 groups by hand.
//
// Read-only. Run: npm run audit:duplicates
//                 npm run audit:duplicates -- --queue   (write them to /admin/matches)

import { PrismaClient } from "@prisma/client";
import { matchDecision } from "../src/lib/scrape-util";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();
const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const lp = (s: string | number, n: number) => String(s).padStart(n);

const NOISE = new Set(["de", "cu", "la", "si", "din", "fara", "pentru", "sau", "un", "o", "g", "gr", "kg", "ml", "l", "buc"]);
function norm(s: string): string {
  return s.toLowerCase()
    .split("ș").join("s").split("ş").join("s").split("ț").join("t").split("ţ").join("t")
    .split("ă").join("a").split("â").join("a").split("î").join("i")
    .replace(/[^a-z0-9]+/g, " ").trim();
}
function bag(name: string): string {
  return [...new Set(norm(name).split(" ").filter((t) => t && !NOISE.has(t)))].sort().join("|");
}

type P = {
  id: number; name: string; slug: string; section: string; brand: string | null;
  unit: string; unitSize: number; ean: string | null; categoryId: number | null;
  offers: { merchantId: number; merchant: { slug: string } }[];
};

async function main(): Promise<void> {
  const queue = process.argv.includes("--queue");
  const products = (await prisma.product.findMany({
    select: {
      id: true, name: true, slug: true, section: true, brand: true, unit: true, unitSize: true,
      ean: true, categoryId: true,
      offers: { select: { merchantId: true, merchant: { select: { slug: true } } } },
    },
  })) as P[];

  const groups = new Map<string, P[]>();
  for (const p of products) {
    const k = `${p.section}::${bag(p.name)}::${p.unit}:${p.unitSize}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(p);
  }
  const dupes = [...groups.values()].filter((g) => g.length > 1);

  // ── DAMAGE. Two kinds, and they are not equally bad.
  type Scored = {
    group: P[];
    sameMerchant: string[];      // merchants appearing on more than one entry — comparability lost
    mergeGains: number;          // distinct merchants a merged entry would compare, vs the best single entry today
    matcherAccepts: boolean | null;
    matcherReason: string;
  };
  const scored: Scored[] = [];
  for (const g of dupes) {
    const perMerchant = new Map<string, number>();
    for (const p of g) for (const s of new Set(p.offers.map((o) => o.merchant.slug))) {
      perMerchant.set(s, (perMerchant.get(s) ?? 0) + 1);
    }
    const sameMerchant = [...perMerchant].filter(([, n]) => n > 1).map(([m]) => m);
    const unionMerchants = perMerchant.size;
    const bestToday = Math.max(...g.map((p) => new Set(p.offers.map((o) => o.merchant.slug)).size));
    const mergeGains = unionMerchants - bestToday;

    // Would the LIVE matcher pair the first two entries today?
    const [a, b] = g;
    let accepts: boolean | null = null;
    let reason = "";
    try {
      const d = matchDecision(
        { name: a.name, brand: a.brand ?? "", ean: a.ean, unit: a.unit, unitSize: a.unitSize },
        { name: b.name, brand: b.brand ?? "", ean: b.ean, unit: b.unit, unitSize: b.unitSize },
        a.section,
      ) as { ok?: boolean; matched?: boolean; score?: number; reason?: string };
      accepts = Boolean(d.ok ?? d.matched);
      reason = `${d.reason ?? "?"} score=${(d.score ?? 0).toFixed(2)}`;
    } catch (e) {
      reason = `threw: ${(e as Error).message.slice(0, 40)}`;
    }
    scored.push({ group: g, sameMerchant, mergeGains, matcherAccepts: accepts, matcherReason: reason });
  }

  // Sorted by damage: same-merchant splits first, then by how many comparisons a merge creates.
  scored.sort((x, y) =>
    (y.sameMerchant.length > 0 ? 1 : 0) - (x.sameMerchant.length > 0 ? 1 : 0) ||
    y.mergeGains - x.mergeGains ||
    y.group.length - x.group.length);

  const severe = scored.filter((s) => s.sameMerchant.length > 0);
  const creates = scored.filter((s) => s.sameMerchant.length === 0 && s.mergeGains > 0);
  const cosmetic = scored.length - severe.length - creates.length;

  console.log("\n════ DUPLICATE CATALOG PRODUCTS ═════════════════════════════════════════════");
  console.log(`  catalog products                      : ${products.length}`);
  console.log(`  duplicate groups (token bag + size)   : ${scored.length}`);
  console.log(`  products inside one                   : ${dupes.reduce((a, g) => a + g.length, 0)}`);
  console.log("");
  console.log(`  SEVERE  one merchant on 2+ entries    : ${severe.length}   <- comparability actively lost`);
  console.log(`  merging would CREATE a comparison     : ${creates.length}`);
  console.log(`  neither (both entries thin)           : ${cosmetic}`);

  // ── DOES THE LIVE MATCHER ALREADY ACCEPT THESE PAIRS?
  const decided = scored.filter((s) => s.matcherAccepts !== null);
  const accepted = decided.filter((s) => s.matcherAccepts);
  console.log("\n  WOULD THE MATCHER PAIR THEM TODAY?");
  console.log(`  pairs tested                          : ${decided.length}`);
  console.log(`  matcher ACCEPTS (word order is fine)   : ${accepted.length}  (${decided.length ? ((accepted.length / decided.length) * 100).toFixed(1) : "0"}%)`);
  console.log(`  matcher REJECTS                       : ${decided.length - accepted.length}`);
  const reasons = new Map<string, number>();
  for (const s of decided.filter((x) => !x.matcherAccepts)) {
    const key = s.matcherReason.replace(/score=[\d.]+/, "").trim() || "(no reason)";
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }
  if (reasons.size) {
    console.log("\n  WHY IT REJECTS (top reasons)");
    for (const [r, n] of [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`    ${lp(n, 6)}  ${r}`);
  }

  // ── THE UPPER BOUND: what comparability becomes if every severe group were merged.
  const live = await prisma.offer.count({ where: { isStale: false, flagged: false, availability: "in stock" } });
  const comparableNow = await prisma.product.count({
    where: { section: "grocery", offers: { some: { isStale: false, flagged: false, availability: "in stock" } } },
  });
  let wouldBecomeComparable = 0;
  for (const s of scored) {
    const merchants = new Set<string>();
    for (const p of s.group) for (const o of p.offers) merchants.add(o.merchant.slug);
    const bestToday = Math.max(...s.group.map((p) => new Set(p.offers.map((o) => o.merchant.slug)).size));
    // A merged entry is comparable when it reaches 2+ merchants and no single entry did today.
    if (merchants.size >= 2 && bestToday < 2) wouldBecomeComparable++;
  }
  // Two different questions, and only reporting the first badly understates the case:
  //   • how many products CROSS the 2-merchant line and become comparable at all
  //   • how many merchant-comparisons are gained overall, including 3 -> 4 on a product that
  //     was already comparable but was comparing against fewer shops than it could
  const totalMerchantGain = scored.reduce((a, s) => a + Math.max(0, s.mergeGains), 0);
  const deepened = scored.filter((s) => s.mergeGains > 0).length;
  console.log("\n  UPPER BOUND IF EVERY DUPLICATE WERE MERGED");
  console.log(`  products that would NEWLY become comparable (cross 2 merchants): ${wouldBecomeComparable}`);
  console.log(`  products whose comparison would DEEPEN (already comparable)     : ${deepened - wouldBecomeComparable < 0 ? 0 : deepened - wouldBecomeComparable}`);
  console.log(`  merchant-comparisons gained in total                            : ${totalMerchantGain}`);
  console.log(`  catalog rows that would disappear                               : ${dupes.reduce((a, g) => a + g.length - 1, 0)}`);
  console.log(`  (grocery products with a live offer today: ${comparableNow}; live offers: ${live})`);
  console.log("");
  console.log("  READ THIS BEFORE SPENDING AN EVENING ON IT: most severe groups are ONE merchant");
  console.log("  filed twice, which is a duplicate LISTING rather than a lost comparison — merging");
  console.log("  those tidies the catalog and changes no price comparison at all.");

  console.log("\n  WORST 15 BY DAMAGE");
  for (const s of scored.slice(0, 15)) {
    const tag = s.sameMerchant.length ? `SEVERE [${s.sameMerchant.join(", ")}]` : `+${s.mergeGains} merchant(s)`;
    console.log(`\n  ${tag}   matcher ${s.matcherAccepts ? "ACCEPTS" : "rejects"}: ${s.matcherReason.slice(0, 60)}`);
    for (const p of s.group) {
      const ms = [...new Set(p.offers.map((o) => o.merchant.slug))];
      console.log(`      #${lp(p.id, 6)} ${pad(p.name, 52)} ${p.unitSize}${p.unit}  [${ms.join(", ") || "no offers"}]`);
    }
  }

  if (queue) {
    // Queue for /admin/matches as its own review type. PendingMatch is the existing review
    // surface; a duplicate is not a store-product-to-catalog decision, so it is labelled
    // distinctly rather than mixed in with fuzzy match candidates.
    let written = 0;
    let skipped = 0;
    let rank = 1;
    for (const s of scored) {
      const [a, ...rest] = s.group;
      for (const b of rest) {
        // ATTACHED TO A REAL MERCHANT, because `PendingMatch.merchantId` is a foreign key and
        // there is no synthetic merchant to hang these on. The one chosen actually holds an
        // offer on the duplicate entry, which is also the person-facing truth: this is the shop
        // whose price is sitting on the wrong half of a split product.
        const merchantId = b.offers[0]?.merchantId ?? a.offers[0]?.merchantId;
        if (!merchantId) { skipped++; continue; }
        const note = s.sameMerchant.length
          ? `SEVERE — ${s.sameMerchant.join(", ")} has offers on BOTH entries, so its own prices cannot compare`
          : `merging would add ${s.mergeGains} merchant(s) to this comparison`;
        const reason =
          `duplicate-product (rank ${rank}) — ${note}. ` +
          `Catalog #${a.id} "${a.name}" vs #${b.id} "${b.name}". ` +
          `Same token bag and size; NOT auto-merged.`;
        try {
          await prisma.pendingMatch.upsert({
            where: { merchantId_storeKey_productId: { merchantId, storeKey: `dup:${a.id}:${b.id}`, productId: a.id } },
            update: { score: 0, reason: reason.slice(0, 500), storeName: b.name.slice(0, 200), lastSeenAt: new Date() },
            create: {
              merchantId, storeKey: `dup:${a.id}:${b.id}`, productId: a.id,
              section: a.section, storeName: b.name.slice(0, 200), storeBrand: b.brand,
              storePriceBani: 0, score: 0, reason: reason.slice(0, 500),
            },
          });
          written++;
        } catch (e) {
          skipped++;
          if (skipped <= 2) console.log(`     skip: ${(e as Error).message.slice(0, 90)}`);
        }
      }
      rank++;
    }
    console.log(`\n  queued ${written} duplicate pair(s) for /admin/matches${skipped ? `, skipped ${skipped}` : ""}`);
    console.log("  ranked by damage: same-merchant splits first, then by comparisons a merge would create.\n");
  } else {
    console.log("\n  Nothing queued. Re-run with --queue to send these to /admin/matches.");
    console.log("  NOTHING IS EVER AUTO-MERGED: the token bag is a detector, not a decision.\n");
  }

  emitJson({
    groups: scored.length,
    severe: severe.length,
    createsComparison: creates.length,
    matcherAccepts: accepted.length,
    matcherTested: decided.length,
    wouldBecomeComparable,
  });
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
