// ── SCOPE: REPORT ONLY ────────────────────────────────────────────────────────
// What words are actually IN the catch-all leaves?
//
// 25% of the categorised catalog sits in an "Altele" leaf, because a merchant named a
// department and nothing finer. That is honest, but it is also the map of the remaining work:
// the words that appear most often in Băcănie's 2,548 leftovers are the shelves that do not
// exist yet, or exist and are not being reached.
//
// WRITES NOTHING AND PROPOSES NOTHING. Deliberately: the last two times a rule was written from
// a frequency list it produced `crema` filing cream cheese under cleaning, and `matura` filing
// aged beef under brooms. A frequency list tells you a word is COMMON; it cannot tell you the
// word means the same thing in every name it appears in. That judgement is the human afternoon.
//
// Read-only. Run: npm run report:altele
//                 npm run report:altele -- --md

import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";
import { isCatchAll } from "../src/lib/category/tree";

const prisma = new PrismaClient();
const TOP = 50;

const lp = (s: string | number, n: number) => String(s).padStart(n);
const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));

/** Stop-words: they are frequent everywhere and identify nothing. */
const NOISE = new Set([
  "de", "cu", "la", "si", "din", "fara", "pentru", "sau", "un", "o", "the", "and", "x", "in",
  "kg", "ml", "buc", "gr", "g", "l", "cl", "cca", "set", "pachet", "bucata", "bucati",
  // Merchant and own-label names: extremely frequent, and never a category.
  "auchan", "metro", "chef", "aro", "sezamo", "freshful", "carrefour", "kaufland", "penny",
  "fine", "life", "pouce", "eco", "bio", "gusturi", "romanesti", "selection",
]);

function norm(s: string): string {
  return s.toLowerCase()
    .split("ș").join("s").split("ş").join("s").split("ț").join("t").split("ţ").join("t")
    .split("ă").join("a").split("â").join("a").split("î").join("i")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

async function main(): Promise<void> {
  const out: string[] = [];
  const say = (l = "") => { out.push(l); console.log(l); };

  const leaves = await prisma.category.findMany({
    where: { section: "grocery", NOT: { parentId: null } },
    select: { id: true, slug: true, name: true },
  });
  const catchAlls = leaves.filter((l) => isCatchAll(l.slug));

  const sized: { id: number; slug: string; name: string; n: number }[] = [];
  for (const c of catchAlls) {
    sized.push({ ...c, n: await prisma.product.count({ where: { categoryId: c.id } }) });
  }
  sized.sort((a, b) => b.n - a.n);

  say("");
  say("════ VOCABULARY INSIDE THE CATCH-ALL LEAVES ═════════════════════════════════");
  say("  A frequency list, nothing more. No rule is proposed and none should be written");
  say("  straight from it: `crema` and `matura` were both common words too.");
  say("");
  for (const s of sized) say(`  ${pad(s.name, 34)} ${lp(s.n, 6)}`);

  for (const leaf of sized.filter((s) => s.n > 0).slice(0, 3)) {
    const rows = await prisma.product.findMany({
      where: { categoryId: leaf.id },
      select: { name: true, brand: true },
    });
    // MARK THE BRANDS from Product.brand — and SAY SO WHEN THAT COLUMN CANNOT ANSWER.
    //
    // The intent was to label "spencer", "marks", "alnatura" so the eye can skip past a maker's
    // name to a word that names a food. But Product.brand is null for ~99% of these rows (24
    // distinct values across Băcănie's 2,548), because the Sezamo pool carries no brand field.
    // A marker that silently never fires is the same shape as a check that reports success
    // while matching nothing, so the coverage is printed and the marker is only claimed to be
    // meaningful when the column is actually populated.
    const brandTokens = new Set<string>();
    let withBrand = 0;
    for (const r of rows) {
      if (r.brand && r.brand.trim()) withBrand++;
      for (const t of norm(r.brand ?? "").split(" ")) if (t.length > 2) brandTokens.add(t);
    }
    const brandCoverage = rows.length ? (withBrand / rows.length) * 100 : 0;
    const freq = new Map<string, number>();
    // Count each token ONCE per product, so a name repeating a word does not inflate it.
    for (const r of rows) {
      for (const t of new Set(norm(r.name).split(" ").filter((x) => x.length > 2 && !NOISE.has(x) && !/^\d/.test(x)))) {
        freq.set(t, (freq.get(t) ?? 0) + 1);
      }
    }
    const top = [...freq].sort((a, b) => b[1] - a[1]).slice(0, TOP);

    say("");
    say("");
    say(`━━ ${leaf.name.toUpperCase()}  —  ${leaf.n} products, ${freq.size} distinct tokens`);
    say(`   top ${TOP} tokens, counted once per product (share of the leaf).`);
    if (brandCoverage >= 20) {
      say(`   "(brand)" = the token also appears in Product.brand here — a maker, not a shelf.`);
    } else {
      say(`   ⚠ BRAND MARKING IS UNAVAILABLE for this leaf: Product.brand is set on only`);
      say(`     ${brandCoverage.toFixed(1)}% of its rows, so maker names below are NOT labelled.`);
      say(`     "marks"/"spencer", "alnatura", "kotanyi", "biona", "yutto", "pronat" are brands.`);
    }
    say("");
    for (let i = 0; i < top.length; i += 2) {
      const cell = (e?: [string, number]) =>
        e ? `${pad(e[0] + (brandTokens.has(e[0]) ? " (brand)" : ""), 24)}${lp(e[1], 6)}  ${lp(((e[1] / leaf.n) * 100).toFixed(1) + "%", 7)}` : "";
      say(`     ${cell(top[i])}     ${cell(top[i + 1])}`);
    }

    // A handful of whole names, because a token list hides what the products actually are.
    const step = Math.max(1, Math.floor(rows.length / 12));
    say("");
    say("   a spread of actual names:");
    for (const r of rows.filter((_, i) => i % step === 0).slice(0, 12)) say(`     · ${r.name.slice(0, 86)}`);
  }

  say("");
  say("  Read this as a map, not a to-do list. A frequent token is a candidate for a shelf");
  say("  ONLY if it means the same thing in every name it appears in — which is the question");
  say("  a frequency count cannot answer.");
  say("");

  if (process.argv.includes("--md")) {
    mkdirSync("reports", { recursive: true });
    writeFileSync("reports/altele-vocabulary.txt", out.join("\n"), "utf8");
    console.log("  wrote reports/altele-vocabulary.txt");
  }
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
