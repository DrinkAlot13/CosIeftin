// ── WHY DOES A STAPLE QUERY RETURN THE WRONG KIND OF PRODUCT? READ-ONLY, DIAGNOSIS FIRST.
//
// Gap 2 performed a real shopping trip and found that the FIRST suggestion for 7 of 20 ordinary
// staples is the wrong kind of thing:
//
//     branza telemea  ->  Dr. Oetker Mix pentru pandispan ... cu branza telemea   (a CAKE MIX)
//     zahar           ->  Zahar pudra cu aroma de vanilie, 80 g                   (icing sugar)
//     ulei ...        ->  aro Ulei Floarea Soarelui 6 x 1 L                       (catering pack)
//     piept de pui    ->  Piept Pui Crispy cca. 2 Kg                              (frozen breaded)
//     cafea           ->  Lavazza Cafea boabe, 1 kg — 99,99                       (a kilo of beans)
//     apa plata       ->  Aqua Carpatica Kids, 0.25 l                             (a children's bottle)
//     cartofi         ->  Cartofi albi eco 500g — 7,99                            (organic, 16 lei/kg)
//
// This prints the top five for each staple WITH ITS SCORE BREAKDOWN, so the cause is read out of
// the ranker rather than guessed at. `scoreOne` already returns a `reason` string naming every
// term that contributed; that is the diagnosis.
//
// NOTHING IS FIXED HERE. The brief asks for the seven to be reported before anything changes,
// because a guess about why would be a guess encoded into a weight.
//
//   npm run audit:staple-search

import { PrismaClient } from "@prisma/client";
import { searchCatalog, type Searchable } from "../src/lib/search/search";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();
const MAX_AGE = 14 * 86_400_000;

/** The twenty a household actually buys, typed the way a person types them. */
const STAPLES = [
  "lapte", "oua", "paine", "unt", "branza telemea", "iaurt", "ulei floarea soarelui",
  "faina", "zahar", "orez", "paste", "rosii", "cartofi", "ceapa", "mere",
  "piept de pui", "cafea", "hartie igienica", "detergent vase", "apa plata",
];

type Row = Searchable & { id: number; slug: string; lowestBani: number };

async function main(): Promise<void> {
  const cutoff = new Date(Date.now() - MAX_AGE);
  const live = { merchant: { active: true }, isStale: false, flagged: false, availability: "in stock", lastObservedAt: { gte: cutoff }, NOT: { priceSource: "DELIVERY_PLATFORM" } } as const;
  const products = await prisma.product.findMany({
    where: { section: "grocery", offers: { some: live } },
    select: {
      id: true, name: true, slug: true, brand: true,
      category: { select: { name: true } },
      offers: { where: live, select: { merchantId: true, priceBani: true, price: true } },
    },
  });

  const catalog: Row[] = products.map((p) => ({
    id: p.id, slug: p.slug, name: p.name, brand: p.brand,
    categoryName: p.category?.name ?? null,
    merchantCount: new Set(p.offers.map((o) => o.merchantId)).size,
    lowestBani: Math.min(...p.offers.map((o) => o.priceBani ?? Math.round(o.price * 100))),
  }));

  console.log("═".repeat(108));
  console.log("STAPLE SEARCH — what the first suggestion actually is, and why the ranker chose it");
  console.log(`${catalog.length} showable grocery products`);
  console.log("═".repeat(108));

  const out: { query: string; top: { name: string; score: number; tier: number; reason: string; lei: string; shops: number }[] }[] = [];

  for (const q of STAPLES) {
    const res = searchCatalog(q, catalog);
    const top = res.results.slice(0, 5).map((r) => ({
      name: r.item.name,
      score: Number(r.score.toFixed(3)),
      tier: r.tier,
      reason: r.reason,
      lei: ((r.item as Row).lowestBani / 100).toFixed(2),
      shops: r.item.merchantCount ?? 0,
    }));
    out.push({ query: q, top });

    console.log(`\n  "${q}"  — ${res.results.length} hits, kind=${res.kind}`);
    for (let i = 0; i < top.length; i++) {
      const t = top[i];
      console.log(`    ${i === 0 ? "->" : "  "} tier ${t.tier} score ${t.score.toFixed(3)}  ${t.lei.padStart(7)} lei  ${t.shops} shops  ${t.name.slice(0, 58)}`);
      console.log(`       ${t.reason}`);
    }
  }

  console.log(`\n${"─".repeat(108)}`);
  console.log("READ THE `reason` LINES. They name every term that contributed, so the cause of a");
  console.log("wrong first result is visible rather than inferred — which is the whole point of");
  console.log("reporting before fixing.");

  emitJson({ catalog: catalog.length, queries: out, pass: true });
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
