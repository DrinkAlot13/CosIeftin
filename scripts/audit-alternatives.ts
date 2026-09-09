// ── ARE THE "SIMILAR PRODUCTS" ACTUALLY SIMILAR, AND HOW MANY SURVIVE? READ-ONLY.
//
// `getAlternatives` picks by NAME SIMILARITY WITH NO CLASS: same section, same unit, size within
// 6%, and — before this audit prompted the fix — a candidate whose name merely CONTAINED the
// source's head noun, sorted cheapest-first. Somebody used the site and got:
//
//     Unt Albalact, 82% grasime, 200 g   ->  MUNTE LACT Creminos cu Unt 60% 200 g   (cheese spread)
//     Lapte de consum integral Olympus   ->  aro Bautura cu Lapte 3.2% grasime 1 L  (a milk drink)
//     aro Ulei Floarea Soarelui 6 x 1 L  ->  aro Bautura Carbogazoasa Lamaie 12 x 0,5 L  (LEMONADE)
//
// each with a one-click "+ adauga" beside it. The last one is the plainest: the head noun of
// `aro Ulei ...` was **"aro"**, the brand, so every `aro` product of a similar size qualified.
//
// A STRICTER GATE IS ONLY BETTER IF THE FEATURE SURVIVES IT. Requiring both sides to share a
// head noun could empty the section, which is a different way of being useless. So this counts
// coverage as well as reading the suggestions: run it before and after a change.
//
//   npm run audit:alternatives
//   npm run audit:alternatives -- --sample=25

import { PrismaClient } from "@prisma/client";
import { getAlternatives } from "../src/lib/queries";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();
const MAX_AGE = 14 * 86_400_000;

async function main(): Promise<void> {
  const a = process.argv.find((x) => x.startsWith("--sample="));
  const SAMPLE = a ? Number(a.split("=")[1]) : 25;
  const N = 300;

  const cutoff = new Date(Date.now() - MAX_AGE);
  const products = await prisma.product.findMany({
    where: {
      section: "grocery",
      offers: { some: { merchant: { active: true }, isStale: false, flagged: false, availability: "in stock", lastObservedAt: { gte: cutoff } } },
    },
    select: { id: true, name: true, brand: true },
    orderBy: { id: "asc" },
    take: N * 4,
  });

  // Spread across the catalog rather than the first N ids, which cluster by merchant.
  const step = Math.max(1, Math.floor(products.length / N));
  const chosen = products.filter((_, i) => i % step === 0).slice(0, N);

  let withAny = 0;
  let totalAlts = 0;
  const shown: string[] = [];

  for (const p of chosen) {
    const alts = await getAlternatives(p.id, 4);
    if (alts.length > 0) withAny++;
    totalAlts += alts.length;
    if (shown.length < SAMPLE && alts.length > 0) {
      shown.push(`  ${p.name.slice(0, 56)}\n     -> ${alts.slice(0, 2).map((x) => `${x.name.slice(0, 46)} (${x.summary.lowest.toFixed(2)})`).join("\n     -> ")}`);
    }
  }

  console.log("═".repeat(100));
  console.log("SIMILAR PRODUCTS — coverage, and whether the suggestions are the same kind of thing");
  console.log("═".repeat(100));
  console.log(`  products sampled                 ${chosen.length}`);
  console.log(`  ...with at least one suggestion  ${withAny}   ${((withAny / Math.max(1, chosen.length)) * 100).toFixed(1)}%`);
  console.log(`  average suggestions per product  ${(totalAlts / Math.max(1, chosen.length)).toFixed(2)}`);

  console.log(`\n${"─".repeat(100)}`);
  console.log(`${shown.length} TO READ — is each really something a shopper would accept instead?`);
  console.log("─".repeat(100));
  for (const s of shown) console.log(s);

  console.log(`\n  Whether a substitution is defensible is a judgement about what people buy, and`);
  console.log(`  per CLAUDE.md no query settles it. Coverage is the number; the list is the check.`);

  emitJson({
    sampled: chosen.length, withAny, coverage: Number((withAny / Math.max(1, chosen.length)).toFixed(4)),
    avgAlternatives: Number((totalAlts / Math.max(1, chosen.length)).toFixed(3)), pass: true,
  });
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
