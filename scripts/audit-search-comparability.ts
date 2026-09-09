// ── DID RANKING ON COMPARABILITY ACTUALLY CHANGE THE FIRST SCREEN? READ-ONLY.
//
// "37/40 fixture cases still pass" says nothing got WORSE. It does not say anything got better,
// and a change that costs nothing and does nothing is still a change to defend.
//
// So this measures the thing the change is for: of the products a shopper sees FIRST, how many
// can actually answer "where is it cheaper".
//
// Run it, then `git stash` the search change and run it again, and diff. That is the same
// before/after discipline CLAUDE.md demands of a parser change, applied to a ranker.
//
//   npm run audit:search-comparability

import { PrismaClient } from "@prisma/client";
import { searchCatalog, type Searchable } from "../src/lib/search/search";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();
const MAX_AGE = 14 * 86_400_000;
const TOP = 10;

/** The queries a person actually types, from the search-quality fixture plus staples. */
const QUERIES = [
  "lapte", "oua", "paine", "unt", "iaurt", "branza", "cascaval", "smantana",
  "ulei floarea soarelui", "faina", "zahar", "orez", "paste", "rosii", "cartofi",
  "ceapa", "mere", "banane", "piept de pui", "cafea", "ceai", "apa plata",
  "suc portocale", "bere", "ciocolata", "biscuiti", "detergent rufe", "hartie igienica",
  "sampon", "pasta de dinti", "hrana pisici", "conserve ton", "miere", "otet",
  "muraturi", "inghetata", "pizza congelata", "sos rosii", "masline", "nuci",
];

type Row = Searchable & { id: number; slug: string };

async function main(): Promise<void> {
  const cutoff = new Date(Date.now() - MAX_AGE);
  const products = await prisma.product.findMany({
    where: { section: "grocery", offers: { some: { merchant: { active: true }, isStale: false, flagged: false, availability: "in stock", lastObservedAt: { gte: cutoff } } } },
    select: {
      id: true, name: true, slug: true, brand: true,
      category: { select: { name: true } },
      offers: {
        where: { merchant: { active: true }, isStale: false, flagged: false, availability: "in stock", lastObservedAt: { gte: cutoff } },
        select: { merchantId: true },
      },
    },
  });

  const catalog: Row[] = products.map((p) => ({
    id: p.id, slug: p.slug, name: p.name, brand: p.brand,
    categoryName: p.category?.name ?? null,
    merchantCount: new Set(p.offers.map((o) => o.merchantId)).size,
  }));

  const overallComparable = catalog.filter((c) => (c.merchantCount ?? 0) >= 2).length;

  console.log("═".repeat(100));
  console.log("SEARCH — how much of the FIRST SCREEN can answer 'where is it cheaper'?");
  console.log("═".repeat(100));
  console.log(`  catalog: ${catalog.length} showable grocery products, ${overallComparable} comparable` +
    `  (${((overallComparable / Math.max(1, catalog.length)) * 100).toFixed(1)}%)`);
  console.log(`  measured over the top ${TOP} of ${QUERIES.length} real queries\n`);

  let topSlots = 0, topComparable = 0, merchantSum = 0;
  const perQuery: { q: string; hits: number; comparable: number; avgMerchants: number; top: string }[] = [];

  for (const q of QUERIES) {
    const out = searchCatalog(q, catalog);
    const top = out.results.slice(0, TOP);
    if (top.length === 0) continue;
    const comparable = top.filter((r) => (r.item.merchantCount ?? 0) >= 2).length;
    const avg = top.reduce((a, r) => a + (r.item.merchantCount ?? 0), 0) / top.length;
    topSlots += top.length;
    topComparable += comparable;
    merchantSum += top.reduce((a, r) => a + (r.item.merchantCount ?? 0), 0);
    perQuery.push({
      q, hits: out.results.length, comparable,
      avgMerchants: Number(avg.toFixed(2)),
      top: `${top[0].item.name.slice(0, 46)} (${top[0].item.merchantCount} shops)`,
    });
  }

  console.log(`  ${"query".padEnd(24)} ${"hits".padStart(6)} ${"cmp/10".padStart(7)} ${"avg shops".padStart(10)}  top result`);
  for (const r of perQuery) {
    console.log(`  ${r.q.padEnd(24)} ${String(r.hits).padStart(6)} ${String(r.comparable).padStart(7)} ${r.avgMerchants.toFixed(2).padStart(10)}  ${r.top}`);
  }

  const share = topComparable / Math.max(1, topSlots);
  console.log(`\n${"─".repeat(100)}`);
  console.log(`  TOP-${TOP} SLOTS FILLED             ${topSlots}`);
  console.log(`  ...that are COMPARABLE        ${topComparable}   ${(share * 100).toFixed(1)}%`);
  console.log(`  average merchants per slot    ${(merchantSum / Math.max(1, topSlots)).toFixed(2)}`);
  console.log(`\n  Against a catalog that is ${((overallComparable / Math.max(1, catalog.length)) * 100).toFixed(1)}% comparable. The gap between these two`);
  console.log(`  numbers is what the ranking is doing.`);

  emitJson({
    catalog: catalog.length, catalogComparable: overallComparable,
    queries: perQuery.length, topSlots, topComparable,
    shareComparable: Number(share.toFixed(4)),
    avgMerchantsPerSlot: Number((merchantSum / Math.max(1, topSlots)).toFixed(3)),
    perQuery, pass: true,
  });
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
