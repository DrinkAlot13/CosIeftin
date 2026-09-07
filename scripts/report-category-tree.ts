// ── SCOPE: REPORT ONLY ────────────────────────────────────────────────────────
// Print the populated grocery tree so a human can judge whether the products belong.
//
// Builds nothing and changes nothing. It reads the DATABASE rather than GROCERY_TREE, because
// the question is what a sidebar built from the database would actually show — and those two
// disagree: the code declares 12 departments and the database holds 15.
//
// IMPORTS ONLY PrismaClient for the counting, in the same spirit as audit-categories: the
// token analysis is re-implemented here rather than shared with the assigner, so a leaf that
// looks coherent to the rules it was built by cannot look coherent here for the same reason.
//
// Run: npm run report:tree            (to stdout)
//      npm run report:tree -- --md    (also writes reports/category-tree.md)

import { PrismaClient } from "@prisma/client";
import { isCatchAll, UNPLACED_LEAF_SLUG } from "../src/lib/category/tree";
import { mkdirSync, writeFileSync } from "node:fs";

const prisma = new PrismaClient();
const SAMPLE = 10;
const THIN_LEAF = 5;
/** A leaf is "incoherent" when its most common token appears in fewer than this share. */
const COHESION_FLOOR = 0.30;

const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const lp = (s: string | number, n: number) => String(s).padStart(n);

const NOISE = new Set([
  "de", "cu", "la", "si", "din", "fara", "pentru", "sau", "un", "o", "kg", "ml", "buc", "gr",
  "g", "l", "bio", "eco", "the", "and", "x",
]);
function norm(s: string): string {
  return s.toLowerCase()
    .split("ș").join("s").split("ş").join("s").split("ț").join("t").split("ţ").join("t")
    .split("ă").join("a").split("â").join("a").split("î").join("i")
    .replace(/[^a-z0-9]+/g, " ").trim();
}
function toks(s: string): string[] {
  return [...new Set(norm(s).split(" ").filter((t) => t.length > 2 && !NOISE.has(t) && !/^\d+$/.test(t)))];
}

type Leaf = {
  id: number; slug: string; name: string; count: number; samples: string[];
  topTokens: { t: string; share: number }[];
};
type Dept = { id: number; slug: string; name: string; inCodeTree: boolean; direct: number; leaves: Leaf[] };

async function main(): Promise<void> {
  const out: string[] = [];
  const say = (line = "") => { out.push(line); console.log(line); };

  const cats = await prisma.category.findMany({
    where: { section: "grocery" },
    select: { id: true, slug: true, name: true, parentId: true },
    orderBy: { id: "asc" },
  });
  const departments = cats.filter((c) => c.parentId === null);
  const totalProducts = await prisma.product.count({ where: { section: "grocery" } });
  // TWO DIFFERENT FACTS, AND THEY MUST NOT BE ADDED TOGETHER.
  //
  //   never-assigned — the assigner has not seen this row (a product created since the last run)
  //   unplaced       — the assigner looked and could not place it
  //
  // Before the Neîncadrate leaf existed both were `categoryId IS NULL`, so the tail was one
  // number that could shrink because categorisation improved OR because a sweep ran. Now the
  // second one is a leaf and is the number that has to fall.
  const neverAssigned = await prisma.product.count({ where: { section: "grocery", categoryId: null } });
  const unplacedLeaf = await prisma.category.findUnique({ where: { slug: UNPLACED_LEAF_SLUG }, select: { id: true } });
  const unplaced = unplacedLeaf
    ? await prisma.product.count({ where: { section: "grocery", categoryId: unplacedLeaf.id } })
    : 0;
  const uncategorised = neverAssigned + unplaced;

  const depts: Dept[] = [];
  for (const d of departments) {
    const direct = await prisma.product.count({ where: { section: "grocery", categoryId: d.id } });
    const leafRows = cats.filter((c) => c.parentId === d.id);
    const leaves: Leaf[] = [];
    for (const l of leafRows) {
      const count = await prisma.product.count({ where: { categoryId: l.id } });
      const rows = await prisma.product.findMany({
        where: { categoryId: l.id },
        select: { name: true },
        orderBy: { id: "asc" },
        take: 400,
      });
      const freq = new Map<string, number>();
      for (const r of rows) for (const t of toks(r.name)) freq.set(t, (freq.get(t) ?? 0) + 1);
      const topTokens = [...freq]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([t, n]) => ({ t, share: rows.length ? n / rows.length : 0 }));
      // Spread the samples across the leaf rather than taking the first ten, which would show
      // ten rows from one merchant's alphabetical block and hide everything else in it.
      const step = Math.max(1, Math.floor(rows.length / SAMPLE));
      const samples = rows.filter((_, i) => i % step === 0).slice(0, SAMPLE).map((r) => r.name);
      leaves.push({ id: l.id, slug: l.slug, name: l.name, count, samples, topTokens });
    }
    depts.push({
      id: d.id, slug: d.slug, name: d.name,
      inCodeTree: leafRows.length > 0,
      direct,
      leaves: leaves.sort((a, b) => b.count - a.count),
    });
  }
  depts.sort((a, b) => b.leaves.reduce((s, l) => s + l.count, 0) - a.leaves.reduce((s, l) => s + l.count, 0));

  const assigned = depts.reduce((s, d) => s + d.leaves.reduce((t, l) => t + l.count, 0) + d.direct, 0);

  say("");
  say("════ POPULATED GROCERY TREE ═════════════════════════════════════════════════");
  say(`  grocery products      : ${totalProducts}`);
  say(`  on a leaf             : ${assigned}  (${((assigned / totalProducts) * 100).toFixed(1)}%)`);
  say(`  never assigned (NULL) : ${neverAssigned}  (${((neverAssigned / totalProducts) * 100).toFixed(1)}%) — the assigner has not seen these`);
  say(`  unplaced (Neîncadrate): ${unplaced}  (${((unplaced / totalProducts) * 100).toFixed(1)}%) — the assigner looked and could not place them`);
  say(`  ─ combined tail       : ${uncategorised}  (${((uncategorised / totalProducts) * 100).toFixed(1)}%)`);
  say(`  departments in DB     : ${departments.length}   leaves in DB: ${cats.length - departments.length}`);
  say("");

  for (const d of depts) {
    const total = d.leaves.reduce((s, l) => s + l.count, 0);
    say("");
    say(`━━ ${d.name.toUpperCase()}  (${d.slug})  —  ${total} products in ${d.leaves.length} leaves${d.direct ? `, ${d.direct} DIRECTLY ON THE DEPARTMENT` : ""}`);
    if (d.leaves.length === 0) { say("     (no leaves — legacy department, nothing filed under it)"); continue; }
    for (const l of d.leaves) {
      const cohesion = l.topTokens[0]?.share ?? 0;
      const marks = [
        l.count < THIN_LEAF ? "THIN" : "",
        l.count > 0 && cohesion < COHESION_FLOOR ? "NO-COMMON-TOKEN" : "",
      ].filter(Boolean).join(" ");
      const tokens = l.topTokens.map((x) => `${x.t} ${(x.share * 100).toFixed(0)}%`).join(", ");
      say("");
      say(`   ${pad(l.name, 34)} ${lp(l.count, 6)}   ${tokens}${marks ? `   ⚠ ${marks}` : ""}`);
      for (const s of l.samples) say(`        · ${s.slice(0, 88)}`);
      if (l.count === 0) say("        (empty)");
    }
  }

  // ── The three flags, gathered so they can be read without the tree.
  // A CATCH-ALL IS ITS OWN CLASS AND MUST NOT POLLUTE THE OTHER TWO FLAGS.
  //
  // "Altele" holds whatever a merchant filed at department level and nothing finer, so it is
  // heterogeneous BY CONSTRUCTION — flagging it for sharing no common token is noise, and an
  // empty one is not a dead end, it just means no merchant named that department. Excluding
  // them is not the same as raising a threshold to make a count fall: they get their own
  // section below, with their sizes stated plainly, because a large Altele is exactly where
  // the remaining vocabulary work is.
  const shelves = (d: Dept) => d.leaves.filter((l) => !isCatchAll(l.slug));
  const thin = depts.flatMap((d) => shelves(d).filter((l) => l.count < THIN_LEAF).map((l) => ({ d, l })));
  const incoherent = depts.flatMap((d) => shelves(d).filter((l) => l.count > 0 && (l.topTokens[0]?.share ?? 0) < COHESION_FLOOR).map((l) => ({ d, l })));
  const catchAlls = depts.flatMap((d) => d.leaves.filter((l) => isCatchAll(l.slug)).map((l) => ({ d, l })));
  const withDirect = depts.filter((d) => d.direct > 0);
  const emptyDepts = depts.filter((d) => d.leaves.length === 0);

  say("");
  say("");
  say("════ FLAGS ══════════════════════════════════════════════════════════════════");
  say("");
  say(`  LEAVES WITH FEWER THAN ${THIN_LEAF} PRODUCTS  —  ${thin.length}`);
  say("  A leaf this thin is a navigation dead end: it costs a click and shows almost nothing.");
  for (const { d, l } of thin) say(`     ${lp(l.count, 4)}  ${pad(d.name, 22)} ${l.name}${l.count ? `   e.g. ${l.samples[0]?.slice(0, 46)}` : ""}`);

  say("");
  say(`  LEAVES WHOSE PRODUCTS SHARE NO COMMON TOKEN  —  ${incoherent.length}`);
  say(`  No token appears in ${(COHESION_FLOOR * 100).toFixed(0)}% of the leaf. Usually means the rule that filled it was`);
  say("  broad, so the leaf holds several unrelated things. Read the samples before trusting it.");
  for (const { d, l } of incoherent) {
    say(`     ${lp(l.count, 5)}  ${pad(d.name, 20)} ${pad(l.name, 30)} top: ${l.topTokens.map((x) => `${x.t} ${(x.share * 100).toFixed(0)}%`).join(", ")}`);
    for (const s of l.samples.slice(0, 4)) say(`              · ${s.slice(0, 74)}`);
  }

  say("");
  const caTotal = catchAlls.reduce((a, x) => a + x.l.count, 0);
  say(`  CATCH-ALL ("ALTELE") LEAVES  —  ${catchAlls.filter((x) => x.l.count > 0).length} populated, ${caTotal} products`);
  say("  Not a flag. This is where a merchant named a DEPARTMENT and no shelf, so it is the");
  say("  honest home for a department-level fact — and the size of each is the best map we have");
  say("  of where vocabulary work would pay. Big ones are not errors; they are unfinished.");
  for (const { d, l } of catchAlls.sort((a, b) => b.l.count - a.l.count)) {
    if (l.count === 0) continue;
    say(`     ${lp(l.count, 5)}  ${pad(d.name, 24)} ${l.topTokens.map((x) => `${x.t} ${(x.share * 100).toFixed(0)}%`).join(", ")}`);
  }
  say(`     ${lp(catchAlls.filter((x) => x.l.count === 0).length, 5)}  empty (no merchant named that department)`);

  say("");
  say(`  DEPARTMENTS HOLDING PRODUCTS DIRECTLY  —  ${withDirect.length}`);
  if (withDirect.length === 0) {
    say("  NONE. Every categorised product sits on a leaf, so a shopper who clicks a department");
    say("  never lands on loose items — the department page is purely a list of its leaves.");
    say(`  The ${uncategorised} products in the tail are on the Neîncadrate leaf or carry no`);
    say("  category at all and are reachable only by search. That is the real gap in the tree.");
  } else {
    for (const d of withDirect) say(`     ${lp(d.direct, 5)}  ${d.name} (${d.slug})`);
  }

  say("");
  say(`  DEPARTMENTS WITH NO LEAVES  —  ${emptyDepts.length}`);
  if (emptyDepts.length) {
    say("  Legacy rows superseded by a renamed department. Harmless in the data, but a sidebar");
    say("  built straight from the database would render them as empty departments.");
    for (const d of emptyDepts) say(`     ${d.name} (${d.slug})`);
  }
  say("");

  if (process.argv.includes("--md")) {
    mkdirSync("reports", { recursive: true });
    writeFileSync("reports/category-tree.txt", out.join("\n"), "utf8");
    console.log("  wrote reports/category-tree.txt");
  }
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
