// STEP 1 — WHICH TOKENS ACTUALLY CAUSE `mutually-distinct` TO FIRE? READ-ONLY.
//
// 70,593 queued pairs, and the question is which WORDS are doing the blocking. This narrows a
// ~30,000-word catalog vocabulary to the few hundred that decide real pairs, ranked by how many
// blocks each causes — so the classification step that follows asks about the words that matter
// rather than about the dictionary.
//
// THIS PART IS STATISTICAL AND IT WORKS. Counting which token appears on one side of a blocked
// pair and not the other is arithmetic. What could NOT be mined — see the descriptor audit — is
// the next question: whether such a token DESCRIBES a product or NAMES one. `uht` and `penne`
// block identically often and mean opposite things, and no frequency measure separates them.
//
// USES THE MATCHER'S OWN TOKENISER on purpose. This is not grading the matcher; it is asking
// which tokens the matcher itself saw. A different tokeniser here would mine a different set of
// words from the ones that actually fired.
//
//   npm run mine:block-tokens
//   npm run mine:block-tokens -- --top=250 --json logs/block-tokens.json

import { PrismaClient } from "@prisma/client";
import { prep, difference } from "../src/lib/scrape-util";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();

type Tok = {
  token: string;
  blocks: number;
  /** How often it appeared on the STORE side vs the CATALOG side — a lopsided token is a house
   *  vocabulary difference rather than a product difference. */
  storeSide: number;
  catalogSide: number;
  /** Tokens it was blocked AGAINST, most frequent first — the other half of each disagreement. */
  against: Map<string, number>;
  examples: { store: string; catalog: string }[];
};

async function main(): Promise<void> {
  const top = Number((process.argv.find((a) => a.startsWith("--top=")) ?? "--top=200").split("=")[1]);

  const rows = await prisma.pendingMatch.findMany({
    where: { reason: "mutually-distinct" },
    select: {
      storeName: true, storeBrand: true,
      product: { select: { name: true, brand: true } },
    },
  });
  console.log("═".repeat(104));
  console.log(`TOKENS THAT CAUSE mutually-distinct TO FIRE — mined from ${rows.length} blocked pairs`);
  console.log("═".repeat(104));

  const toks = new Map<string, Tok>();
  const bump = (t: string, side: "store" | "catalog", against: string[], ex: { store: string; catalog: string }) => {
    const e: Tok = toks.get(t) ?? { token: t, blocks: 0, storeSide: 0, catalogSide: 0, against: new Map<string, number>(), examples: [] };
    e.blocks++;
    if (side === "store") e.storeSide++; else e.catalogSide++;
    for (const a of against) e.against.set(a, (e.against.get(a) ?? 0) + 1);
    if (e.examples.length < 5) e.examples.push(ex);
    toks.set(t, e);
  };

  let usable = 0;
  for (const r of rows) {
    const st = prep(r.storeName, r.storeBrand, null);
    const cat = prep(r.product.name, r.product.brand, null);
    const stOnly = [...difference(st.over, cat.over)];
    const catOnly = [...difference(cat.over, st.over)];
    // A pair is only informative if BOTH sides had something unique — that is the rule firing.
    if (stOnly.length === 0 || catOnly.length === 0) continue;
    usable++;
    const ex = { store: r.storeName, catalog: r.product.name };
    for (const t of stOnly) bump(t, "store", catOnly, ex);
    for (const t of catOnly) bump(t, "catalog", stOnly, ex);
  }

  const ranked = [...toks.values()].sort((a, b) => b.blocks - a.blocks);
  const totalTokens = ranked.length;
  const cumulative: number[] = [];
  let run = 0;
  for (const t of ranked) { run += t.blocks; cumulative.push(run); }
  const totalIncidences = run;

  console.log(`\n  pairs where both sides carried a unique token   ${usable} of ${rows.length}`);
  console.log(`  DISTINCT TOKENS doing the blocking               ${totalTokens}`);
  const at = (n: number) => (cumulative[Math.min(n, cumulative.length) - 1] / totalIncidences * 100).toFixed(1);
  console.log(`  top 100 tokens cover                            ${at(100)}% of all block incidences`);
  console.log(`  top 200                                         ${at(200)}%`);
  console.log(`  top 400                                         ${at(400)}%`);
  console.log(`\n  ⇒ THIS IS THE PART THAT WORKS. A ~30,000-word vocabulary reduces to a few hundred`);
  console.log(`    tokens that decide real pairs. Only those need classifying.`);

  console.log(`\n${"─".repeat(104)}`);
  console.log(`TOP ${top} BY BLOCKS CAUSED`);
  console.log(`"lopsided" = appears mostly on ONE side; a house-vocabulary word rather than a product word.`);
  console.log("─".repeat(104));
  console.log(`  ${"#".padStart(4)} ${"token".padEnd(20)} ${"blocks".padStart(7)} ${"store".padStart(6)} ${"catalog".padStart(8)}  most often blocked against`);
  for (const [i, t] of ranked.slice(0, top).entries()) {
    const against = [...t.against.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k).join(" ");
    const lop = Math.abs(t.storeSide - t.catalogSide) / t.blocks > 0.8 ? "*" : " ";
    console.log(`  ${String(i + 1).padStart(4)} ${t.token.padEnd(20)} ${String(t.blocks).padStart(7)} ${String(t.storeSide).padStart(6)} ${String(t.catalogSide).padStart(8)} ${lop} ${against}`);
  }

  emitJson({
    blockedPairs: rows.length,
    usablePairs: usable,
    distinctTokens: totalTokens,
    coverage: { top100: at(100), top200: at(200), top400: at(400) },
    tokens: ranked.slice(0, 500).map((t) => ({
      token: t.token, blocks: t.blocks, storeSide: t.storeSide, catalogSide: t.catalogSide,
      against: [...t.against.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => ({ token: k, n: v })),
      examples: t.examples,
    })),
    pass: true,
  });
  console.log(`\n  Full ranking with examples written to the --json path, for the classification step.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
