// PHASE 6(d) — a real basket of 20 staples, through the REAL optimizer, over HTTP.
//
// Not a unit test and not a re-implementation: it POSTs to /api/basket/v2 exactly as the page
// does, then checks every offer the optimizer CHOSE against the database directly. Those two
// halves are the point — the brief's rule is to verify by rendered output and by database
// query, never from the source that produced it.
//
// WHAT WOULD BE A LIVE BUG. `currentOfferWhere` and `isCurrent` define "a price we can stand
// behind": in stock, not stale, not flagged, seen within 14 days, merchant active. The
// optimizer must never choose an offer failing any of those. If it does, a shopper is being
// sent to a shop for a price we are withholding everywhere else on the site.
//
//   npm run audit:real-basket
//   npm run audit:real-basket -- --url=http://localhost:3000

import { PrismaClient } from "@prisma/client";
import { INDEX_BASKET } from "../src/lib/index-basket";

const prisma = new PrismaClient();
const lei = (b: number): string => (b / 100).toFixed(2);
const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));

type Reso = {
  status: string;
  offer: { id: number; productId: number; merchantId: number; priceBani: number; product: { name: string } } | null;
  totalBani: number;
  quantityPlan: { offerId: number; units: number }[];
  reason: { code: string; requestedProductName?: string; chosenProductName?: string };
};
type Basket = {
  merchant: { id: number; name: string; slug: string; deliveryFeeBani: number; freeDeliveryOverBani: number | null; minOrderBani: number | null };
  resolved: { line: { productId: number }; resolution: Reso }[];
  substituted: { line: { productId: number }; resolution: Reso }[];
  unavailable: { line: { productId: number }; resolution: Reso }[];
  subtotalBani: number; deliveryFeeBani: number; totalBani: number;
  complete: boolean; meetsMinimum: boolean; missingExactLines: number;
};

async function main(): Promise<void> {
  const base = (process.argv.find((a) => a.startsWith("--url=")) ?? "--url=http://localhost:3000").split("=").slice(1).join("=");
  const items = INDEX_BASKET.slice(0, 20).map((i) => ({ slug: i.slug, qty: 1, mode: "EQUIVALENT" }));

  console.log(`${"═".repeat(104)}\nA REAL BASKET — 20 staples, through POST ${base}/api/basket/v2\n${"═".repeat(104)}`);
  for (const [i, it] of items.entries()) console.log(`  ${String(i + 1).padStart(2)}. ${it.slug}`);

  const res = await fetch(`${base}/api/basket/v2`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items, maxStores: 3 }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const out = await res.json() as {
    perMerchant: Basket[]; bestSingle: Basket | null;
    split: { assignments: { merchantId: number; line: { productId: number }; resolution: Reso }[]; storesUsed: number; goodsBani: number; deliveryBani: number; totalBani: number; complete: boolean };
    savingsVsSingleBani: number | null;
    marginalStoreValue: { name: string; savesBani: number }[];
    unknown: string[];
  };

  if (out.unknown.length) console.log(`\n  UNKNOWN SLUGS (not in the catalog): ${out.unknown.join(", ")}`);

  // ── Every shop, ranked ─────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(104)}\nPER SHOP\n${"─".repeat(104)}`);
  console.log(`  ${pad("shop", 18)} ${"exact".padStart(6)} ${"subst".padStart(6)} ${"missing".padStart(8)} ${"goods".padStart(10)} ${"delivery".padStart(9)} ${"TOTAL".padStart(10)}  complete?`);
  for (const b of out.perMerchant) {
    console.log(`  ${pad(b.merchant.name, 18)} ${String(b.resolved.length).padStart(6)} ${String(b.substituted.length).padStart(6)} ${String(b.unavailable.length).padStart(8)} ${lei(b.subtotalBani).padStart(10)} ${lei(b.deliveryFeeBani).padStart(9)} ${lei(b.totalBani).padStart(10)}  ${b.complete ? "yes" : `NO — ${b.unavailable.length} line(s) unsupplied`}`);
  }
  console.log(`\n  A basket that could not fill every line is NOT comparable as cheaper. Only the`);
  console.log(`  'complete' rows above may be compared with each other.`);

  const best = out.bestSingle;
  console.log(`\n  BEST SINGLE SHOP: ${best ? `${best.merchant.name} — ${lei(best.totalBani)} lei (${lei(best.subtotalBani)} goods + ${lei(best.deliveryFeeBani)} delivery)` : "none could fill the basket"}`);
  console.log(`  SPLIT ACROSS ${out.split.storesUsed} SHOPS: ${lei(out.split.totalBani)} lei (${lei(out.split.goodsBani)} + ${lei(out.split.deliveryBani)} delivery)${out.split.complete ? "" : "  — INCOMPLETE"}`);
  if (out.savingsVsSingleBani != null) console.log(`  splitting saves ${lei(out.savingsVsSingleBani)} lei`);
  for (const m of out.marginalStoreValue ?? []) console.log(`    adding ${m.name} saves ${lei(m.savesBani)} lei`);

  // ── Every line of the winning plan, with its deep link ──────────────────────
  const plan = out.split.assignments ?? [];
  const merchantName = new Map(out.perMerchant.map((b) => [b.merchant.id, b.merchant.name]));
  const chosenOfferIds = plan.map((a) => a.resolution.offer?.id).filter((x): x is number => x != null);

  // THE DATABASE HALF: what is actually true of the offers it picked.
  const dbOffers = await prisma.offer.findMany({
    where: { id: { in: chosenOfferIds } },
    select: {
      id: true, availability: true, isStale: true, flagged: true, flagReason: true,
      lastObservedAt: true, priceBani: true, productUrl: true, url: true, priceSource: true,
      merchant: { select: { name: true, active: true } },
      product: { select: { name: true, slug: true } },
    },
  });
  const byId = new Map(dbOffers.map((o) => [o.id, o]));
  const cutoff = new Date(Date.now() - 14 * 86_400_000);

  console.log(`\n${"─".repeat(104)}\nTHE PLAN — every line, what it chose and why, with the link to open it\n${"─".repeat(104)}`);
  const problems: string[] = [];
  let printed = 0;
  for (const a of plan) {
    const r = a.resolution;
    const db = r.offer ? byId.get(r.offer.id) : undefined;
    printed++;
    const shop = merchantName.get(a.merchantId) ?? String(a.merchantId);
    console.log(`\n  ${String(printed).padStart(2)}. ${r.reason.requestedProductName ?? `product #${a.line.productId}`}`);
    console.log(`      -> ${r.reason.chosenProductName ?? db?.product.name ?? "(nothing)"}`);
    console.log(`      ${pad(shop, 16)} ${lei(r.totalBani).padStart(9)} lei   ${r.status} / ${r.reason.code}`);
    if (r.quantityPlan.length > 1 || (r.quantityPlan[0]?.units ?? 1) > 1) {
      console.log(`      packs: ${r.quantityPlan.map((q) => `${q.units} x offer ${q.offerId}`).join(" + ")}`);
    }
    if (db) {
      const link = db.productUrl ?? db.url ?? "(no link)";
      console.log(`      ${link}`);
      // ── the checks that would each be a live bug
      const stale = db.isStale;
      const oos = db.availability !== "in stock";
      const flagged = db.flagged;
      const old = db.lastObservedAt == null || db.lastObservedAt < cutoff;
      const inactive = !db.merchant.active;
      const dp = db.priceSource === "DELIVERY_PLATFORM";
      const bad: string[] = [];
      if (stale) bad.push("STALE");
      if (oos) bad.push(`NOT IN STOCK (${db.availability})`);
      if (flagged) bad.push(`FLAGGED: ${db.flagReason ?? ""}`);
      if (old) bad.push(`UNSEEN since ${db.lastObservedAt?.toISOString().slice(0, 10) ?? "never"}`);
      if (inactive) bad.push("MERCHANT INACTIVE");
      if (dp) bad.push("DELIVERY_PLATFORM price (excluded everywhere else)");
      if (bad.length) {
        console.log(`      *** ${bad.join(" · ")}`);
        problems.push(`offer ${db.id} (${shop}, ${db.product.name.slice(0, 40)}): ${bad.join(", ")}`);
      }
      if (r.offer && db.priceBani != null && r.offer.priceBani !== db.priceBani) {
        const msg = `offer ${db.id}: optimizer priced ${lei(r.offer.priceBani)} but the database says ${lei(db.priceBani)}`;
        console.log(`      *** ${msg}`);
        problems.push(msg);
      }
    } else if (r.status !== "UNAVAILABLE") {
      problems.push(`line for product #${a.line.productId} is ${r.status} but names no offer`);
    }
  }

  console.log(`\n${"═".repeat(104)}`);
  if (problems.length === 0) {
    console.log(`✓ Every offer the optimizer chose is one we would show anywhere else on the site:`);
    console.log(`  in stock, not stale, not flagged, seen within 14 days, active merchant, and not a`);
    console.log(`  delivery-platform price. ${chosenOfferIds.length} offers checked against the database.`);
  } else {
    console.log(`✗ ${problems.length} PROBLEM(S) — the optimizer chose an offer the rest of the site withholds:`);
    for (const p of problems) console.log(`    ${p}`);
    process.exitCode = 1;
  }
  console.log(`\nDEPOSITS: the optimizer's OfferLike carries no deposit field, so no SGR deposit is`);
  console.log(`included in any total above. For a basket with bottled drinks that understates the`);
  console.log(`till price by 0,50 lei per container. Reported, not fixed — see PROPOSALS.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
