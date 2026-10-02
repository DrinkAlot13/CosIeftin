// Cluster report for manual equivalence-class curation.
//
// Groups every grocery product that still has no EquivalenceClass by (canonical unit,
// head-noun) — the same key `structuralCandidateIds` uses for the runtime fallback. The
// point of this report is NOT to assign anything automatically: it exists so a person (or an
// agent acting as one) can read each cluster's actual member names and decide, the way
// CLAUDE.md says this judgment has to be made — "is sparkling water equivalent to still
// water" is a fact about the world, not something a token-overlap score can answer.
//
// Sorted largest-first because the distribution is long-tailed: a small number of big
// clusters account for most of the uncovered catalog, so reviewing in size order gets the
// most value per cluster read.
//
//   npm run cluster:report                  top 150 clusters, 12 example names each
//   npm run cluster:report -- --n=50 --min=5 --examples=20

import { prisma } from "../src/lib/db";
import { headNoun } from "../src/lib/scrape-util";
import { normalizeText } from "../src/lib/matching";

function arg(name: string, fallback: number): number {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split("=")[1]) : fallback;
}

async function main() {
  const N = arg("n", 150);
  const MIN = arg("min", 3);
  const EXAMPLES = arg("examples", 12);

  const products = await prisma.product.findMany({
    where: { section: "grocery", equivalenceClassId: null, offers: { some: { availability: "in stock", isStale: false, flagged: false } } },
    select: { id: true, name: true, brand: true, unit: true, unitSize: true, offers: { where: { availability: "in stock", isStale: false, flagged: false }, select: { merchantId: true } } },
  });

  type Member = { name: string; brand: string | null; unitSize: number; merchants: Set<number> };
  const clusters = new Map<string, Member[]>();
  for (const p of products) {
    const head = headNoun(normalizeText(p.name), normalizeText(p.brand ?? ""));
    if (!head) continue;
    const key = `${p.unit}::${head}`;
    const list = clusters.get(key) ?? [];
    list.push({ name: p.name, brand: p.brand, unitSize: p.unitSize, merchants: new Set(p.offers.map((o) => o.merchantId)) });
    clusters.set(key, list);
  }

  const ranked = [...clusters.entries()]
    .filter(([, members]) => members.length >= MIN)
    .map(([key, members]) => {
      const merchantSet = new Set<number>();
      for (const m of members) for (const mid of m.merchants) merchantSet.add(mid);
      return { key, members, merchantCount: merchantSet.size };
    })
    .sort((a, b) => b.members.length - a.members.length)
    .slice(0, N);

  console.log(`${ranked.length} clusters (of ${clusters.size} total, >=${MIN} members), largest first.\n`);
  for (const c of ranked) {
    const sizes = [...new Set(c.members.map((m) => m.unitSize))].sort((a, b) => a - b);
    console.log(`=== ${c.key}  (${c.members.length} products, ${c.merchantCount} merchants, sizes: ${sizes.slice(0, 8).join(", ")}${sizes.length > 8 ? "…" : ""}) ===`);
    for (const m of c.members.slice(0, EXAMPLES)) console.log(`  ${m.name}`);
    if (c.members.length > EXAMPLES) console.log(`  … +${c.members.length - EXAMPLES} more`);
    console.log("");
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
