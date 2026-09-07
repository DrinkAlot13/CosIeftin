// ── SCOPE: REPORT ONLY. Measures a rule; changes nothing.
//
// `mutually-distinct` is the single biggest block in the matcher: 20,503 undecided pairs at
// DCNeu, 11,242 at Auchan, 10,409 at Metro. It is also the rule that stopped one Nivea shower
// gel backing 17 products across three merchants, so it is not a candidate for loosening on
// instinct.
//
// THE RULE: if EACH side carries a significant token the other lacks, the two names make
// different claims and are different products. "Chipsuri cu sare" vs "Chipsuri cu paprica".
//
// THE SUSPECTED FAILURE: the rule cannot tell a VARIANT token from NOISE. "Auchan" on one side
// and "Pouce" on the other are both merchant house brands, not flavours; "feliat", "punga",
// "la punga", "cca" describe packaging. If those are what is distinguishing the two names, the
// block is wrong and a real comparison is being lost.
//
// So this samples blocked pairs and classifies the distinguishing tokens, WITHOUT changing the
// rule. The brief's gate is a measured false-block rate before any code moves.
//
// Run: npm run audit:mutually-distinct

import { PrismaClient } from "@prisma/client";
import { normalizeRo } from "../src/lib/text/normalizeRo";

const prisma = new PrismaClient();
const SAMPLE = Number(process.env.SAMPLE ?? 100);
const MERCHANTS = ["dcneu", "auchan", "metro"];

const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const lp = (s: string | number, n: number): string => String(s).padStart(n);

/**
 * Words that describe HOW a product is packaged or WHO sells it, not WHAT it is.
 *
 * Written from the catalog, not from memory, and deliberately conservative: every entry is a
 * word that cannot distinguish two products of the same kind. A word that MIGHT be a variant —
 * a flavour, a scent, a strength — is not here, because the cost of getting that wrong is a
 * false match, which publishes one product's price on another.
 *
 * This list is used to CLASSIFY the sample, not to change the rule. If it turns out to explain
 * most of the blocks, that is the evidence for a narrower fix; if it does not, the rule is
 * working and the blocks are real.
 */
const PACKAGING_NOISE = new Set([
  "feliat", "feliate", "felii", "punga", "plasa", "cutie", "caserola", "tavita", "vrac",
  "bucata", "bucati", "buc", "cca", "aprox", "ambalat", "portionat", "portionata",
  "refrigerat", "refrigerata", "proaspat", "proaspata", "congelat", "congelata",
  "gastro", "familial", "format", "pachet", "set", "promo", "oferta", "nou", "premium",
]);

/** Merchant house brands — a name that says who sells it, not what it is. */
const HOUSE_BRANDS = new Set([
  "auchan", "pouce", "aro", "metro", "chef", "carrefour", "sezamo", "mega", "freshful",
  "cocorico", "gusturi", "romanesti", "selection", "fine", "life",
  "everyday", "winny", "actuel", "boni", "penny", "kaufland",
]);
// REMOVED after reading the sample: "clasic", "eco", "bio", "excellence". Every one of them is
// a VARIANT word in this catalog — "ASEVI Clasic" vs "ASEVI Purple", "CLEAR Men Clasic" vs
// "3in1 Cool" — and listing them as house brands made the classifier call two correct blocks
// wrong. A list of words that "cannot distinguish two products" has to be checked against the
// products, not written from the shape of the word.

type Verdict = "correct" | "noise-only" | "house-brand-only" | "arguable";

function tokensOf(s: string): Set<string> {
  return new Set(normalizeRo(s).split(/\s+/).filter((t) => t.length > 2 && !/^\d+$/.test(t)));
}

function classify(catOnly: string[], stOnly: string[]): Verdict {
  const meaningful = (ts: string[]): string[] =>
    ts.filter((t) => !PACKAGING_NOISE.has(t) && !HOUSE_BRANDS.has(t));
  const c = meaningful(catOnly);
  const s = meaningful(stOnly);
  // Strip noise and house brands from both sides. If either side then has nothing left, the
  // "mutual" distinction was never mutual: one side was only saying who sells it or how it is
  // wrapped, and the rule blocked on that.
  if (c.length === 0 && s.length === 0) return "noise-only";
  if (c.length === 0 || s.length === 0) {
    const allBrand = [...catOnly, ...stOnly].every((t) => HOUSE_BRANDS.has(t) || PACKAGING_NOISE.has(t) || meaningful([t]).length > 0);
    return allBrand ? "house-brand-only" : "noise-only";
  }
  // Both sides still carry a real word the other lacks. Short words are where variants live
  // ("Brut" vs "Rose"), so a one-token difference on each side is the rule working, not failing.
  if (c.length === 1 && s.length === 1) return "correct";
  return "arguable";
}

async function main(): Promise<void> {
  console.log(`\n════ mutually-distinct — IS THE BLOCK CORRECT? ══════════════════════════════`);
  console.log(`  Measurement only. No rule is changed here, and none may be changed in this`);
  console.log(`  commit — the brief is explicit about that.\n`);

  const merchants = await prisma.merchant.findMany({ where: { slug: { in: MERCHANTS } }, select: { id: true, slug: true } });
  const total = await prisma.pendingMatch.count({ where: { reason: "mutually-distinct", resolved: false } });
  console.log(`  undecided mutually-distinct pairs, all merchants: ${total}`);

  const rows: { merchant: string; storeName: string; catalogName: string; score: number }[] = [];
  for (const m of merchants) {
    const n = await prisma.pendingMatch.count({ where: { merchantId: m.id, reason: "mutually-distinct", resolved: false } });
    if (n === 0) continue;
    const take = Math.ceil(SAMPLE / merchants.length);
    // Deterministic spread rather than random: every Nth row, so re-running reports the same
    // sample and a claim about it can be checked.
    const step = Math.max(1, Math.floor(n / take));
    const page = await prisma.pendingMatch.findMany({
      where: { merchantId: m.id, reason: "mutually-distinct", resolved: false },
      select: { storeName: true, score: true, product: { select: { name: true } } },
      orderBy: { id: "asc" },
    });
    for (let i = 0; i < page.length && rows.filter((r) => r.merchant === m.slug).length < take; i += step) {
      rows.push({ merchant: m.slug, storeName: page[i].storeName, catalogName: page[i].product.name, score: page[i].score });
    }
  }

  const counts: Record<Verdict, number> = { correct: 0, "noise-only": 0, "house-brand-only": 0, arguable: 0 };
  const examples: Record<Verdict, string[]> = { correct: [], "noise-only": [], "house-brand-only": [], arguable: [] };

  for (const r of rows) {
    const catT = tokensOf(r.catalogName);
    const stT = tokensOf(r.storeName);
    const catOnly = [...catT].filter((t) => !stT.has(t));
    const stOnly = [...stT].filter((t) => !catT.has(t));
    const v = classify(catOnly, stOnly);
    counts[v]++;
    if (examples[v].length < 6) {
      examples[v].push(
        `${pad(r.merchant, 11)} ${r.score.toFixed(2)}  ${pad(r.catalogName, 44)}\n` +
        `${" ".repeat(19)}${pad(r.storeName, 44)}\n` +
        `${" ".repeat(19)}catalog-only {${catOnly.join(", ")}}  store-only {${stOnly.join(", ")}}`,
      );
    }
  }

  const n = rows.length;
  const wrong = counts["noise-only"] + counts["house-brand-only"];
  console.log(`\n  SAMPLE OF ${n} BLOCKED PAIRS (every Nth, reproducible)\n`);
  console.log(`  ${pad("verdict", 22)} ${lp("pairs", 7)} ${lp("share", 8)}`);
  console.log(`  ${"-".repeat(40)}`);
  console.log(`  ${pad("correct block", 22)} ${lp(counts.correct, 7)} ${lp(((counts.correct / n) * 100).toFixed(1) + "%", 8)}`);
  console.log(`  ${pad("arguable", 22)} ${lp(counts.arguable, 7)} ${lp(((counts.arguable / n) * 100).toFixed(1) + "%", 8)}`);
  console.log(`  ${pad("packaging noise only", 22)} ${lp(counts["noise-only"], 7)} ${lp(((counts["noise-only"] / n) * 100).toFixed(1) + "%", 8)}  ← wrong block`);
  console.log(`  ${pad("house brand only", 22)} ${lp(counts["house-brand-only"], 7)} ${lp(((counts["house-brand-only"] / n) * 100).toFixed(1) + "%", 8)}  ← wrong block`);
  console.log(`\n  FALSE-BLOCK RATE: ${((wrong / n) * 100).toFixed(1)}%   (the brief's threshold for acting is 30%)`);

  for (const v of ["noise-only", "house-brand-only", "arguable", "correct"] as Verdict[]) {
    if (examples[v].length === 0) continue;
    console.log(`\n  ── ${v.toUpperCase()}`);
    for (const e of examples[v]) console.log(`    ${e}\n`);
  }

  console.log(`  NOTE ON THE CLASSIFIER. "wrong block" here means the distinguishing tokens are`);
  console.log(`  packaging or house-brand words, judged against two hand-written lists in this`);
  console.log(`  file. That is evidence, not proof: a word on those lists could still be a real`);
  console.log(`  discriminator somewhere. Read the examples before trusting the rate.\n`);

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
