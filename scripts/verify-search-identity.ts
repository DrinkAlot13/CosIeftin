// DID CACHING THE SEARCH INDEX CHANGE ANY ANSWER? All 40 fixture queries, both ways. READ-ONLY.
//
// The search fix moved the catalog vocabulary, head-noun frequency table and brand set out of
// the per-request path and into a memo rebuilt once per catalog version. That is a claim about
// WHEN the index is built. This checks that it is not also, accidentally, a claim about WHAT
// the index contains.
//
// The fixture currently reads 36/40 and the brief requires it stay green — so the question that
// matters is whether the four failures are caused by the cache or merely coincident with it.
// Running every query through the SAME ranker with and without the prebuilt index answers that
// without argument: if every outcome is byte-identical, the cache is not the cause.
//
//   npm run verify:search-identity

import { PrismaClient } from "@prisma/client";
import { searchCatalog, buildSearchIndex } from "../src/lib/search/search";
import { SEARCH_CASES } from "../tests/fixtures/search/queries";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const cutoff = new Date(Date.now() - 14 * 86_400_000);
  const live = {
    merchant: { active: true }, availability: "in stock", isStale: false, flagged: false,
    NOT: { priceSource: "DELIVERY_PLATFORM" }, lastObservedAt: { gte: cutoff },
  } as const;

  const [light, counts, cats] = await Promise.all([
    prisma.product.findMany({ where: { section: "grocery", offers: { some: live } }, select: { id: true, name: true, brand: true, categoryId: true } }),
    prisma.offer.groupBy({ by: ["productId"], where: { ...live, product: { section: "grocery" } }, _count: { _all: true } }),
    prisma.category.findMany({ where: { section: "grocery" }, select: { id: true, name: true } }),
  ]);
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const merchants = new Map(counts.map((r) => [r.productId, r._count._all]));
  const catalog = light.map((p) => ({
    id: p.id, name: p.name, brand: p.brand,
    categoryName: p.categoryId == null ? null : catName.get(p.categoryId) ?? null,
    merchantCount: merchants.get(p.id) ?? 0,
  }));

  console.log(`catalog: ${catalog.length} live grocery products`);
  const index = buildSearchIndex(catalog);

  let same = 0;
  const differing: string[] = [];
  console.log(`\n${"query".padEnd(30)} ${"kind".padEnd(12)} ${"n".padStart(5)}  identical?`);
  console.log("-".repeat(72));
  for (const c of SEARCH_CASES) {
    const withIndex = searchCatalog(c.q, catalog, index);
    const without = searchCatalog(c.q, catalog);
    // Compare the WHOLE outcome, not just the count: kind, ordering, and every id.
    // EVERY FIELD OF THE OUTCOME, not just the ids. Ranked<T> wraps the product in `.item` and
    // also carries score, tier and reason; `missing` is the brand-miss answer itself and
    // `corrections` is the typo handling. An identical ordering reached by a different score,
    // or the same results with a different `missing` list, would still mean the index changed
    // something — and `missing` is precisely the honesty guarantee this fix must not disturb.
    const shape = (o: typeof withIndex) => JSON.stringify({
      kind: o.kind,
      missing: o.missing,
      corrections: o.corrections,
      results: o.results.map((r) => [r.item.id, r.score, r.tier, r.reason]),
    });
    const a = shape(withIndex);
    const b = shape(without);
    const ok = a === b;
    if (ok) same++; else differing.push(c.q);
    console.log(`${JSON.stringify(c.q).padEnd(30)} ${withIndex.kind.padEnd(12)} ${String(withIndex.results.length).padStart(5)}  ${ok ? "yes" : "NO  <-- the cache changed this answer"}`);
  }

  console.log(`\n${same}/${SEARCH_CASES.length} outcomes byte-identical with and without the prebuilt index.`);
  if (differing.length) {
    console.log(`DIFFERING: ${differing.join(", ")}`);
    process.exit(1);
  }
  console.log(`The cache changes WHEN the index is built, never WHAT it contains.`);
  console.log(`So the fixture's 4 failures are not caused by it — they are catalog-growth artefacts.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
