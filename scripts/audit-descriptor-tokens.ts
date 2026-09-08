// WHICH WORDS ARE DESCRIPTIONS, AND WHICH NAME A DIFFERENT PRODUCT? Mined from the data.
//
// Both open problems reduce to this one question:
//
//   `mutually-distinct` blocks "Lapte UHT Napolact 3.5%" against "Lapte de consum integral
//   Napolact 3.5%" because each side has a token the other lacks. It is right that the tokens
//   differ and wrong that they distinguish: `uht` and `de consum integral` describe the same
//   attribute of the same milk.
//
//   The catalog-duplicate detector has the mirror problem. Grouping on brand + size alone put
//   53 Barilla pastas in one group — Fusilli, Penne, Lasagne — because nothing in my
//   discriminator list knew that a pasta SHAPE names a different product. Merging them would
//   have destroyed twelve comparisons.
//
// One question, two failures: which tokens carry product identity, and which are description?
//
// ── HOW THIS ANSWERS IT WITHOUT EITHER OF US WRITING A LIST.
//
// A token that NAMES a product is one whose presence excludes its siblings: a pack of Fusilli is
// not a pack of Penne, so within one brand and size, `fusilli` and `penne` appear on DIFFERENT
// rows and essentially never together.
//
// A token that DESCRIBES is one that appears alongside anything: `uht` sits with `integral`,
// with `degresat`, with nothing at all — because it is answering a different question from the
// one that names the product.
//
// So for each token, within brand+size cohorts, measure:
//
//   SIBLING SPREAD   how many distinct OTHER tokens it co-occurs with across the catalog.
//                    High = descriptive. Low = it belongs to one product family.
//   EXCLUSIVITY      of the rows in its cohort, how many carry it. A shape word appears on one
//                    row of twelve; a descriptor appears on many.
//
// Neither number is a verdict. This prints the ranking for a person to read, because deciding
// that `uht` is description and `fusilli` is identity is a judgement about groceries, not a
// property of the data — see CLAUDE.md, "SOME DEFECTS HAVE NO AUTOMATED DETECTOR".
//
//   npm run audit:descriptors

import { PrismaClient } from "@prisma/client";
import { normalizeRo } from "../src/lib/text/normalizeRo";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();

const STOP = new Set([
  "din", "cu", "de", "la", "si", "pentru", "fara", "the", "gr", "kg", "ml", "buc", "gram",
  "grame", "litru", "litri", "bucata", "bucati", "pachet", "set",
]);

async function main(): Promise<void> {
  const cutoff = new Date(Date.now() - 14 * 86_400_000);
  const rows = await prisma.product.findMany({
    where: {
      offers: {
        some: {
          merchant: { active: true }, availability: "in stock", isStale: false, flagged: false,
          lastObservedAt: { gte: cutoff },
        },
      },
    },
    select: { id: true, name: true, brand: true, unit: true, unitSize: true },
  });

  // Cohort = brand + unit + size. Within a cohort, every row is a candidate sibling.
  const vocab = new Set<string>();
  for (const r of rows) {
    const b = (r.brand ?? "").trim();
    if (b && b.toLowerCase() !== "non-brand") for (const t of normalizeRo(b).split(/\s+/)) if (t.length >= 4) vocab.add(t);
  }
  const brandOf = (r: { brand: string | null; name: string }): string | null => {
    const b = (r.brand ?? "").trim();
    if (b && b.toLowerCase() !== "non-brand" && b !== "(bucata)") return normalizeRo(b);
    for (const t of normalizeRo(r.name).split(/\s+/)) if (t.length >= 4 && vocab.has(t)) return t;
    return null;
  };

  const toks = (r: { name: string; brand: string | null }): string[] => {
    const brandTokens = new Set(normalizeRo(r.brand ?? "").split(/\s+/).filter(Boolean));
    return [...new Set(normalizeRo(r.name).split(/\s+/))]
      .filter((t) => t.length > 2 && !STOP.has(t) && !brandTokens.has(t) && !/^\d/.test(t));
  };

  const cohorts = new Map<string, { name: string; brand: string | null }[]>();
  for (const r of rows) {
    const b = brandOf(r);
    if (!b) continue;
    const key = `${b}|${r.unit}|${r.unitSize.toPrecision(3)}`;
    cohorts.set(key, [...(cohorts.get(key) ?? []), r]);
  }

  // For each token: how many distinct co-occurring tokens, and its share of the cohorts it is in.
  const coOccur = new Map<string, Set<string>>();
  const inCohortRows = new Map<string, number>();
  const cohortRows = new Map<string, number>();
  const seenIn = new Map<string, Set<string>>();

  for (const [key, members] of cohorts) {
    if (members.length < 2) continue;
    for (const m of members) {
      const ts = toks(m);
      for (const t of ts) {
        const co = coOccur.get(t) ?? new Set<string>();
        for (const u of ts) if (u !== t) co.add(u);
        coOccur.set(t, co);
        inCohortRows.set(t, (inCohortRows.get(t) ?? 0) + 1);
        const s = seenIn.get(t) ?? new Set<string>();
        s.add(key);
        seenIn.set(t, s);
      }
    }
    for (const m of members) {
      for (const t of new Set(toks(m))) cohortRows.set(t, (cohortRows.get(t) ?? 0) + members.length / new Set(toks(m)).size);
    }
  }

  type Row = { token: string; rows: number; cohorts: number; siblings: number; share: number };
  const stats: Row[] = [];
  for (const [t, co] of coOccur) {
    const rowsWith = inCohortRows.get(t) ?? 0;
    if (rowsWith < 8) continue; // too rare to characterise
    const cohortCount = seenIn.get(t)?.size ?? 0;
    stats.push({ token: t, rows: rowsWith, cohorts: cohortCount, siblings: co.size, share: rowsWith / Math.max(1, cohortCount) });
  }

  // DESCRIPTIVE = wide sibling spread AND appears on many rows per cohort.
  // IDENTITY = narrow sibling spread OR appears on roughly one row per cohort.
  const byDescriptive = [...stats].sort((a, b) => b.siblings * b.share - a.siblings * a.share);
  const byIdentity = [...stats].sort((a, b) => a.share - b.share || a.siblings - b.siblings);

  console.log("═".repeat(104));
  console.log("TOKENS RANKED — description at the top, product identity at the bottom");
  console.log("Within brand+size cohorts. Neither end is a verdict; this is for reading.");
  console.log("═".repeat(104));
  console.log(`  ${"token".padEnd(20)} ${"rows".padStart(6)} ${"cohorts".padStart(8)} ${"siblings".padStart(9)} ${"rows/cohort".padStart(12)}`);
  console.log(`\n── MOST DESCRIPTION-LIKE (co-occur with everything, appear on many rows per cohort)`);
  for (const s of byDescriptive.slice(0, 30)) {
    console.log(`  ${s.token.padEnd(20)} ${String(s.rows).padStart(6)} ${String(s.cohorts).padStart(8)} ${String(s.siblings).padStart(9)} ${s.share.toFixed(2).padStart(12)}`);
  }
  console.log(`\n── MOST IDENTITY-LIKE (one row per cohort — the word that names THIS product)`);
  for (const s of byIdentity.slice(0, 30)) {
    console.log(`  ${s.token.padEnd(20)} ${String(s.rows).padStart(6)} ${String(s.cohorts).padStart(8)} ${String(s.siblings).padStart(9)} ${s.share.toFixed(2).padStart(12)}`);
  }

  // The specific words the two failures turn on, wherever they rank.
  const WATCH = ["uht", "consum", "integral", "proaspat", "pet", "cutie", "grasime", "degresat",
    "semidegresat", "fusilli", "penne", "spaghetti", "lasagne", "farfalle", "linguine", "rigate",
    "smantana", "verdeata", "lapte", "paste"];
  console.log(`\n── THE WORDS THE TWO FAILURES TURN ON`);
  console.log(`  ${"token".padEnd(20)} ${"rows".padStart(6)} ${"cohorts".padStart(8)} ${"siblings".padStart(9)} ${"rows/cohort".padStart(12)}`);
  for (const w of WATCH) {
    const s = stats.find((x) => x.token === w);
    console.log(`  ${w.padEnd(20)} ${s ? String(s.rows).padStart(6) : "     —"} ${s ? String(s.cohorts).padStart(8) : "       —"} ${s ? String(s.siblings).padStart(9) : "        —"} ${s ? s.share.toFixed(2).padStart(12) : "           —"}`);
  }

  emitJson({ tokens: stats, mostDescriptive: byDescriptive.slice(0, 60), mostIdentity: byIdentity.slice(0, 60), pass: true });
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
