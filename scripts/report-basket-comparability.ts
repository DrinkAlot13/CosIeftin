// ── SCOPE: REPORT ONLY ────────────────────────────────────────────────────────
// Comparability on the basket a shopper actually buys, not on the whole catalog.
//
// The 8.1% catalog figure answers "of everything we hold, how much can be compared". That is
// the right number for judging the pipeline and the wrong one for describing the experience:
// the catalog is dominated by long-tail items nobody puts in a list, and a shopper who wants
// milk, bread, eggs and oil never meets most of it.
//
// ONE DEFINITION, APPLIED TO BOTH. The catalog-wide baseline here is recomputed with the SAME
// rule as the basket rather than quoted from `audit:comparability`, because comparing a number
// produced by one definition against a number produced by another is how this project got
// 8,822 phantom failures and two different outlier thresholds. If the baseline printed here
// differs from the audit's, the difference is the definition, and the audit's is the one that
// governs the pipeline.
//
// "Comparable" = N distinct ACTIVE merchants each have an offer a shopper can see today:
// in stock, not stale, not withheld, not a delivery-platform price. That is `currentOfferWhere`,
// the same filter the listing pages and the sidebar counts use.
//
// Read-only. Run: npm run report:basket

import { PrismaClient } from "@prisma/client";
import { currentOfferWhere } from "../src/lib/queries";
import { INDEX_BASKET } from "../src/lib/index-basket";
import { RECIPES } from "../src/data/recipes";

const prisma = new PrismaClient();
const lp = (s: string | number, n: number) => String(s).padStart(n);
const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));

type Row = { id: number; name: string; merchants: number };

function distribution(rows: Row[]): string[] {
  const n = rows.length;
  const at = (k: number) => rows.filter((r) => r.merchants >= k).length;
  const pct = (v: number) => (n ? ((v / n) * 100).toFixed(1) + "%" : "—");
  return [
    `  products in the set            ${lp(n, 7)}`,
    `  priced at all (1+ merchant)    ${lp(at(1), 7)}   ${pct(at(1))}`,
    `  COMPARABLE (2+ merchants)      ${lp(at(2), 7)}   ${pct(at(2))}`,
    `  3+ merchants                   ${lp(at(3), 7)}   ${pct(at(3))}`,
    `  4+ merchants                   ${lp(at(4), 7)}   ${pct(at(4))}`,
    `  not priced anywhere today      ${lp(n - at(1), 7)}   ${pct(n - at(1))}`,
  ];
}

async function merchantsFor(ids: number[]): Promise<Map<number, number>> {
  const live = currentOfferWhere();
  const out = new Map<number, number>();
  for (const id of ids) {
    const offers = await prisma.offer.findMany({
      where: { ...live, productId: id },
      select: { merchantId: true },
    });
    out.set(id, new Set(offers.map((o) => o.merchantId)).size);
  }
  return out;
}

async function main(): Promise<void> {
  console.log("\n════ COMPARABILITY ON THE REAL BASKET ═══════════════════════════════════════");
  console.log("  Comparable = 2+ distinct merchants with an offer visible today.");

  // ── 1. The pinned index basket (by slug) ───────────────────────────────────────
  const pinned = await prisma.product.findMany({
    where: { slug: { in: INDEX_BASKET.map((b) => b.slug) } },
    select: { id: true, name: true, slug: true },
  });
  const missingPins = INDEX_BASKET.filter((b) => !pinned.some((p) => p.slug === b.slug));

  // ── 2. Recipe ingredients, via their equivalence classes ───────────────────────
  // A recipe names a NEED ("unt-200g"), not a product, so the set is every product that can
  // satisfy that need. Counting only one representative would understate a class that several
  // merchants stock under different names — which is the whole point of the class.
  const classSlugs = [...new Set(RECIPES.flatMap((r) => r.ingredients.map((i) => i.classSlug)))];
  const classes = await prisma.equivalenceClass.findMany({
    where: { slug: { in: classSlugs } },
    select: { slug: true, label: true, products: { select: { id: true, name: true } } },
  });
  const missingClasses = classSlugs.filter((s) => !classes.some((c) => c.slug === s));
  const recipeProducts = classes.flatMap((c) => c.products);

  const basketIds = [...new Set([...pinned.map((p) => p.id), ...recipeProducts.map((p) => p.id)])];
  const basketNames = new Map<number, string>();
  for (const p of [...pinned, ...recipeProducts]) basketNames.set(p.id, p.name);

  const basketCounts = await merchantsFor(basketIds);
  const basketRows: Row[] = basketIds.map((id) => ({ id, name: basketNames.get(id) ?? "?", merchants: basketCounts.get(id) ?? 0 }));

  // The 40 pins on their own. They are the tightest definition of "the common basket" we have
  // — one named product per staple, chosen by hand — and mixing them into the 270 products the
  // recipe classes expand to buries them.
  const pinCounts = await merchantsFor(pinned.map((p) => p.id));
  const pinRows: Row[] = pinned.map((p) => ({ id: p.id, name: p.name, merchants: pinCounts.get(p.id) ?? 0 }));
  console.log("\n── THE 40 PINNED INDEX PRODUCTS, on their own ────────────────────────────────");
  for (const l of distribution(pinRows)) console.log(l);

  console.log("\n── THE COMMON BASKET ─────────────────────────────────────────────────────────");
  console.log(`  ${INDEX_BASKET.length} pinned index products + ${classSlugs.length} recipe needs`);
  console.log(`  (${classes.length} of those needs resolve to ${recipeProducts.length} products)`);
  if (missingPins.length) console.log(`  ⚠ ${missingPins.length} pinned slug(s) no longer resolve: ${missingPins.map((m) => m.key).join(", ")}`);
  if (missingClasses.length) console.log(`  ⚠ ${missingClasses.length} recipe class(es) have no EquivalenceClass row: ${missingClasses.join(", ")}`);
  console.log("");
  for (const l of distribution(basketRows)) console.log(l);

  // ── 3. The 300 products with the most offers ───────────────────────────────────
  // NO USAGE DATA EXISTS: GroceryList and GroceryListItem are both empty, so "most-searched"
  // and "most-added" cannot be answered. Offer count is the stated fallback and it is a
  // different thing — it measures what MERCHANTS stock, not what shoppers want, and it is
  // biased toward exactly the products that are already comparable. Read it as an upper bound.
  const grouped = await prisma.offer.groupBy({
    by: ["productId"],
    where: { ...currentOfferWhere(), product: { section: "grocery" } },
    _count: { _all: true },
    orderBy: { _count: { productId: "desc" } },
    take: 300,
  });
  const topIds = grouped.map((g) => g.productId);
  const topProducts = await prisma.product.findMany({ where: { id: { in: topIds } }, select: { id: true, name: true } });
  const topNames = new Map(topProducts.map((p) => [p.id, p.name]));
  const topCounts = await merchantsFor(topIds);
  const topRows: Row[] = topIds.map((id) => ({ id, name: topNames.get(id) ?? "?", merchants: topCounts.get(id) ?? 0 }));

  console.log("\n── THE 300 MOST-STOCKED GROCERY PRODUCTS ─────────────────────────────────────");
  console.log("  ⚠ NOT most-searched or most-added: GroceryList and GroceryListItem are EMPTY,");
  console.log("    so no usage data exists. This is the stated fallback and it is biased —");
  console.log("    ranking by offer count selects for products that are already comparable.");
  console.log("");
  for (const l of distribution(topRows)) console.log(l);

  // ── 4. The catalog baseline, SAME definition ───────────────────────────────────
  const allIds = (await prisma.product.findMany({
    where: { section: "grocery", offers: { some: currentOfferWhere() } },
    select: { id: true },
  })).map((p) => p.id);
  const rows = await prisma.offer.findMany({
    where: { ...currentOfferWhere(), product: { section: "grocery" } },
    select: { productId: true, merchantId: true },
  });
  const perProduct = new Map<number, Set<number>>();
  for (const r of rows) {
    const s = perProduct.get(r.productId) ?? new Set<number>();
    s.add(r.merchantId);
    perProduct.set(r.productId, s);
  }
  const allRows: Row[] = allIds.map((id) => ({ id, name: "", merchants: perProduct.get(id)?.size ?? 0 }));

  console.log("\n── THE WHOLE GROCERY CATALOG, same definition ────────────────────────────────");
  for (const l of distribution(allRows)) console.log(l);

  console.log("\n── SIDE BY SIDE (2+ merchants) ───────────────────────────────────────────────");
  const share = (r: Row[]) => (r.length ? ((r.filter((x) => x.merchants >= 2).length / r.length) * 100).toFixed(1) + "%" : "—");
  console.log(`  ${pad("the common basket", 34)} ${lp(share(basketRows), 8)}`);
  console.log(`  ${pad("300 most-stocked", 34)} ${lp(share(topRows), 8)}`);
  console.log(`  ${pad("whole grocery catalog", 34)} ${lp(share(allRows), 8)}`);

  console.log("\n  WORST OF THE BASKET (priced by one merchant or none)");
  for (const r of basketRows.filter((x) => x.merchants < 2).slice(0, 15)) {
    console.log(`    ${lp(r.merchants, 2)}  ${r.name.slice(0, 72)}`);
  }
  console.log("");
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
