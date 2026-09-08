// ── SCOPE: PHASE 2 — HOW BIG IS THE MATCHING GAP, REALLY? READ-ONLY. ──────────
//
// Three widely-stocked products showed "1 magazine". The diagnosis found the cause (eleven
// catalog rows for one Napolact) and two fixes landed. THIS measures what is left across 500
// products instead of three, so "is an AI reviewer worth building" rests on a number.
//
// ── THE QUESTION, restated so the method can be judged against it.
//
//   For a product we carry: how many merchants do we SHOW, and how many merchants have a store
//   product that plausibly IS it — and of those, how many would the CURRENT rules already accept?
//
// That last clause is the one that decides the model question, and it is why this script exists
// rather than a spreadsheet. A gap the existing rules already accept is plumbing. A gap they
// refuse is a judgement, and only a judgement needs a judge.
//
// ── HOW THE 500 ARE CHOSEN, and why not the obvious way.
//
// The obvious selection — "the products with the biggest gap" — measures the selection. So does
// "the products in the most shops", which picks the ones already working.
//
// So selection runs on BRAND UBIQUITY: how many distinct merchants mention this brand anywhere
// in their OWN product names. A property of the brand, taken from merchants' words, independent
// of any individual product's gap. A brand on eight shelves is a national brand, which is as
// much of "widely stocked" as we can observe. Products are then taken from those brands, one per
// (brand, head noun, unit, size), so eleven Napolact rows enter as one target rather than eleven.
//
// ── HOW A CANDIDATE IS TESTED. Three gates, and the last two are the point.
//
//   1. PRE-FILTER   same brand (on the row or in the merchant's own name), same head noun,
//                   size within tolerance. Cheap, and deliberately generous.
//
//   2. `decide()`   the project's own matcher, run on the pair. NOT circular: the matcher
//                   compares a STORE ITEM against a CATALOG ROW, and it only ever sees the rows
//                   candidate selection surfaced. Here a target row meets a store item that
//                   already sits somewhere else — a comparison nothing in this project makes.
//                   It brings dose comparison, variant markers, the low-overlap floor and the
//                   size gate, all of which a hand-rolled test in this file got wrong.
//
//   3. BELONGS-HERE an offer attaches to exactly ONE catalog row. If it already sits on a row it
//                   fits BETTER than ours, the merchant is not missing our product — it is
//                   selling that one, and counting it here would double-count a shelf.
//
// **THE FIRST TWO VERSIONS OF THIS SCRIPT HAD NO GATE 2 OR 3, AND BOTH REPORTED NONSENSE.**
// Version one put `Pate de pui Bucegi 120g` beside `Pate porc cu unt 120g` — chicken is not
// pork. Version two added a variant-marker test, which does not cover `pui`/`porc`, and still
// matched `Iaurt grecesc Olympus 10%` to `Iaurt grecesc 2%` (numbers are dropped before
// tokenisation — CLAUDE.md says compare strength explicitly, and `decide()` does), `Pate de pui`
// to `Pate de pui cu trufe`, and `Surasul Soarelui` to a correctly-attached Unisol oil, because
// `soarelui` is both a brand word and a common noun. Every one of those is caught by running the
// real matcher instead of approximating it.
//
// ── THE BLIND SPOT, stated up front because it is large and it points at this measure's own
// weakest merchants. The pre-filter needs the brand somewhere: on the row, or in the merchant's
// own name for it. The brand-in-name survey measured Mega Image at 1.8%, Freshful at 2.2% and
// Carrefour at 33.3%. Where a merchant omits the brand AND the row it landed on has none, the
// candidate is invisible here. The script counts those offers rather than leaving it to be
// remembered: every figure below is a FLOOR, and most of a floor at those three.
//
//   npm run audit:brand-gap
//   npm run audit:brand-gap -- --targets=500 --sample=40

import { PrismaClient } from "@prisma/client";
import { normalizeRo } from "../src/lib/text/normalizeRo";
import { sigTokens, prep, decide, SIZE_TOLERANCE } from "../src/lib/scrape-util";
import { isDescriptor } from "../src/lib/matching/descriptors";
import { variantConflict } from "../src/lib/variant-classes";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();
const MAX_AGE = 14 * 86_400_000;

/** Brand words too generic to anchor on — matching on these would merge unrelated shelves. */
const GENERIC_BRAND = new Set([
  "bio", "eco", "the", "and", "for", "nou", "produs", "casa", "gust",
  // A place of origin printed on half the produce aisle is not a brand. Without this,
  // "Zmeura Romania 125g" pre-filters against every Romanian-labelled row in the catalog.
  "romania", "romanesc", "romanesti",
]);

/**
 * ONE FLAVOUR, TWO SPELLINGS. `variant-classes.ts` lists the singular and the plural of the
 * same fruit as separate values and compares them by EXACT set membership, so "Suc de
 * portocale" against "Suc de portocala" is a flavour CONTRADICTION and a hard REJECT before
 * anything is scored — the one comparison in the matcher that is not fuzzy, in a file whose
 * own header says enumerating flavours is a game you lose.
 *
 * Listed here to MEASURE the blast radius, not to fix it. Nothing in the matcher reads this.
 */
const FLAVOUR_SYNONYMS: string[][] = [
  ["portocale", "portocala"], ["capsuni", "capsuna"], ["cirese", "cireasa"],
  ["visine", "visina"], ["piersici", "piersica"], ["mar", "mere"], ["para", "pere"],
  ["banane", "banana"], ["afine", "afina"], ["mure", "mura"], ["struguri", "strugure"],
];
const SYNONYM_OF = new Map<string, string>();
for (const g of FLAVOUR_SYNONYMS) for (const w of g) SYNONYM_OF.set(w, g[0]);
const sameFlavour = (a: string[], b: string[]): boolean =>
  a.some((x) => b.some((y) => (SYNONYM_OF.get(x) ?? x) === (SYNONYM_OF.get(y) ?? y)));

/** A brand on this many distinct merchants' shelves counts as national for selection. */
const NATIONAL_BRAND_MERCHANTS = 4;

function brandTokens(brand: string | null | undefined): string[] {
  if (!brand) return [];
  return normalizeRo(brand)
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !GENERIC_BRAND.has(t));
}

/** The significant tokens that NAME the product: not the brand, not a pure descriptor. */
function contentTokens(name: string, bTokens: string[]): string[] {
  const bset = new Set(bTokens);
  return sigTokens(normalizeRo(name)).filter((t) => !bset.has(t) && !isDescriptor(t));
}

function sizesAgree(a: number, aUnit: string, b: number, bUnit: string): boolean {
  if (!a || !b) return false;
  if (aUnit.toLowerCase() !== bUnit.toLowerCase()) return false;
  return Math.abs(a - b) / Math.max(a, b) <= SIZE_TOLERANCE;
}

type LiveOffer = {
  merchant: string;
  storeName: string | null;
  ownUnit: string | null;
  ownUnitSize: number | null;
  productId: number;
  catBrand: string | null;
  catName: string;
  catUnit: string;
  catUnitSize: number;
};

async function main(): Promise<void> {
  const argNum = (flag: string, dflt: number): number => {
    const a = process.argv.find((x) => x.startsWith(`--${flag}=`));
    return a ? Number(a.split("=")[1]) : dflt;
  };
  const TARGETS = argNum("targets", 500);
  const SAMPLE = argNum("sample", 40);

  const cutoff = new Date(Date.now() - MAX_AGE);
  const liveWhere = {
    merchant: { active: true },
    availability: "in stock",
    isStale: false,
    flagged: false,
    lastObservedAt: { gte: cutoff },
    product: { section: "grocery" },
  } as const;

  const offers: LiveOffer[] = (
    await prisma.offer.findMany({
      where: liveWhere,
      select: {
        storeName: true, ownUnit: true, ownUnitSize: true, productId: true,
        merchant: { select: { slug: true } },
        product: { select: { brand: true, name: true, unit: true, unitSize: true } },
      },
    })
  ).map((o) => ({
    merchant: o.merchant.slug,
    storeName: o.storeName,
    ownUnit: o.ownUnit,
    ownUnitSize: o.ownUnitSize,
    productId: o.productId,
    catBrand: o.product.brand,
    catName: o.product.name,
    catUnit: o.product.unit,
    catUnitSize: o.product.unitSize,
  }));

  // ── STEP 1. BRAND UBIQUITY, from merchants' own words. ──────────────────────────────────
  // A merchant counts for a brand if it either sells a catalog row of that brand or writes the
  // brand into one of its own product names. Both are the merchant saying "I stock this brand".
  const brandMerchants = new Map<string, Set<string>>();
  const allBrands = new Set<string>();
  for (const o of offers) for (const t of brandTokens(o.catBrand)) allBrands.add(t);

  /** The brand tokens this offer evidences — its row's brand, plus any brand it names itself. */
  const brandsOf = (o: LiveOffer): Set<string> => {
    const own = ` ${normalizeRo(o.storeName ?? "")} `;
    const seen = new Set(brandTokens(o.catBrand));
    for (const t of allBrands) if (own.includes(` ${t} `)) seen.add(t);
    return seen;
  };

  const offersByBrandToken = new Map<string, LiveOffer[]>();
  for (const o of offers) {
    for (const t of brandsOf(o)) {
      let s = brandMerchants.get(t);
      if (!s) brandMerchants.set(t, (s = new Set()));
      s.add(o.merchant);
      const l = offersByBrandToken.get(t);
      if (l) l.push(o); else offersByBrandToken.set(t, [o]);
    }
  }

  // ── STEP 2. THE 500 TARGETS. ────────────────────────────────────────────────────────────
  const products = await prisma.product.findMany({
    where: { section: "grocery", brand: { not: null }, offers: { some: liveWhere } },
    select: { id: true, name: true, slug: true, brand: true, unit: true, unitSize: true },
  });

  const offersByProduct = new Map<number, LiveOffer[]>();
  for (const o of offers) {
    const l = offersByProduct.get(o.productId);
    if (l) l.push(o); else offersByProduct.set(o.productId, [o]);
  }

  type Target = {
    id: number; name: string; slug: string; brand: string;
    unit: string; unitSize: number;
    bTokens: string[]; head: string;
    ubiquity: number; shown: Set<string>;
  };

  const candidates: Target[] = [];
  for (const p of products) {
    const bTokens = brandTokens(p.brand);
    if (bTokens.length === 0) continue;
    const ubiquity = Math.max(...bTokens.map((t) => brandMerchants.get(t)?.size ?? 0));
    if (ubiquity < NATIONAL_BRAND_MERCHANTS) continue;
    const content = contentTokens(p.name, bTokens);
    if (content.length === 0) continue;
    if (!p.unitSize || p.unitSize <= 0) continue;
    candidates.push({
      id: p.id, name: p.name, slug: p.slug, brand: p.brand as string,
      unit: p.unit, unitSize: p.unitSize,
      bTokens, head: content[0], ubiquity,
      shown: new Set((offersByProduct.get(p.id) ?? []).map((o) => o.merchant)),
    });
  }

  // One target per (brand, head noun, unit, size): the eleven Napolact rows are ONE product,
  // and entering all eleven would count the same gap eleven times.
  const byFamily = new Map<string, Target>();
  for (const c of candidates) {
    const key = `${c.bTokens.join("+")}|${c.head}|${c.unit}|${c.unitSize.toFixed(3)}`;
    const prev = byFamily.get(key);
    if (!prev || c.shown.size > prev.shown.size) byFamily.set(key, c);
  }

  const targets = [...byFamily.values()]
    .sort((a, b) => b.ubiquity - a.ubiquity || b.shown.size - a.shown.size || a.id - b.id)
    .slice(0, TARGETS);

  // ── STEP 3. FOR EACH TARGET, WHO ELSE PLAUSIBLY HAS IT. ─────────────────────────────────
  type Verdict = "ACCEPTS" | "REFUSES" | "BELONGS-ELSEWHERE";
  type GapRow = {
    target: string; slug: string; brand: string; size: string;
    merchant: string; route: "MIS-ATTACHED" | "BY NAME";
    verdict: Verdict; reason: string; score: number;
    evidence: string; evidenceFull: string; onRow: string;
    /** For a variant refusal: the two conflicting values, and whether they are one word twice. */
    conflict?: string; synonymOnly?: boolean;
  };

  const gapRows: GapRow[] = [];
  const perTarget: {
    slug: string; name: string; brand: string;
    shown: number; accepts: number; plausible: number;
  }[] = [];

  for (const t of targets) {
    const tPrep = prep(t.name, t.brand, null);
    const tSize = { unit: t.unit, unitSize: t.unitSize };

    const pool = new Map<string, LiveOffer>();
    for (const bt of t.bTokens) {
      for (const o of offersByBrandToken.get(bt) ?? []) pool.set(`${o.merchant}|${o.productId}|${o.storeName}`, o);
    }

    const acceptsMerchants = new Set(t.shown);
    const plausibleMerchants = new Set(t.shown);
    const best = new Map<string, GapRow>();

    for (const o of pool.values()) {
      if (t.shown.has(o.merchant)) continue;
      if (o.productId === t.id) continue;

      // GATE 1 — pre-filter. Size from the merchant's own figure when it published one.
      const size = o.ownUnitSize && o.ownUnitSize > 0 ? o.ownUnitSize : o.catUnitSize;
      const unit = o.ownUnitSize && o.ownUnitSize > 0 ? (o.ownUnit ?? o.catUnit) : o.catUnit;
      if (!sizesAgree(t.unitSize, t.unit, size, unit)) continue;

      const otherTokens = new Set(sigTokens(normalizeRo(`${o.storeName ?? ""} ${o.catName}`)));
      if (!otherTokens.has(t.head)) continue;

      const sameCatalogBrand = brandTokens(o.catBrand).some((x) => t.bTokens.includes(x));
      const brandInStoreName = t.bTokens.some((x) => ` ${normalizeRo(o.storeName ?? "")} `.includes(` ${x} `));
      if (!sameCatalogBrand && !brandInStoreName) continue;

      plausibleMerchants.add(o.merchant);

      // GATE 2 — the project's own matcher, on the pair.
      const stName = o.storeName ?? o.catName;
      const stPrep = prep(stName, o.catBrand, null);
      const stSize = { unit, unitSize: size };
      const here = decide(tPrep, tSize, stPrep, stSize, "grocery");

      // GATE 3 — does this offer belong to us, or to the row it already sits on?
      const there = decide(
        prep(o.catName, o.catBrand, null),
        { unit: o.catUnit, unitSize: o.catUnitSize },
        stPrep, stSize, "grocery",
      );
      const belongsHere = !there.ok || here.score >= there.score;

      const verdict: Verdict = !here.ok ? "REFUSES" : belongsHere ? "ACCEPTS" : "BELONGS-ELSEWHERE";
      if (verdict === "ACCEPTS") acceptsMerchants.add(o.merchant);

      const route: GapRow["route"] = sameCatalogBrand ? "MIS-ATTACHED" : "BY NAME";
      const key = `${t.slug}|${o.merchant}`;
      const rank = (v: Verdict): number => (v === "ACCEPTS" ? 2 : v === "REFUSES" ? 1 : 0);
      const existing = best.get(key);
      if (!existing || rank(verdict) > rank(existing.verdict) || (rank(verdict) === rank(existing.verdict) && here.score > existing.score)) {
        const vc = here.reason.startsWith("variant-") ? variantConflict(t.name, stName) : null;
        best.set(key, {
          target: t.name, slug: t.slug, brand: t.brand,
          size: `${t.unitSize} ${t.unit}`,
          merchant: o.merchant, route, verdict,
          reason: here.reason, score: Number(here.score.toFixed(3)),
          evidence: stName.slice(0, 58),
          evidenceFull: stName,
          onRow: o.catName.slice(0, 52),
          conflict: vc ? `${vc.a.join("/")} vs ${vc.b.join("/")}` : undefined,
          synonymOnly: vc ? sameFlavour(vc.a, vc.b) : undefined,
        });
      }
    }

    for (const r of best.values()) gapRows.push(r);
    perTarget.push({
      slug: t.slug, name: t.name, brand: t.brand,
      shown: t.shown.size, accepts: acceptsMerchants.size, plausible: plausibleMerchants.size,
    });
  }

  // ── STEP 4. THE HEADLINE. ───────────────────────────────────────────────────────────────
  const comparableNow = perTarget.filter((p) => p.shown >= 2).length;
  const comparableAccepts = perTarget.filter((p) => p.accepts >= 2).length;
  const comparablePlausible = perTarget.filter((p) => p.plausible >= 2).length;
  const oneShopNow = perTarget.filter((p) => p.shown === 1).length;
  const sumShown = perTarget.reduce((a, p) => a + p.shown, 0);
  const sumAccepts = perTarget.reduce((a, p) => a + p.accepts, 0);
  const sumPlausible = perTarget.reduce((a, p) => a + p.plausible, 0);

  console.log("═".repeat(104));
  console.log(`PHASE 2 — THE MATCHING GAP ACROSS ${targets.length} WIDELY-STOCKED BRANDED GROCERY PRODUCTS`);
  console.log("═".repeat(104));
  console.log(`  brands seen at >=${NATIONAL_BRAND_MERCHANTS} merchants        ${[...brandMerchants.values()].filter((s) => s.size >= NATIONAL_BRAND_MERCHANTS).length}`);
  console.log(`  catalog rows eligible                 ${candidates.length}`);
  console.log(`  after collapsing brand+size families  ${byFamily.size}`);
  console.log(`  targets measured                      ${targets.length}`);

  console.log(`\n  ${"".padEnd(36)} ${"SHOWN".padStart(10)} ${"ACCEPTS".padStart(10)} ${"PLAUSIBLE".padStart(10)}`);
  console.log(`  ${"merchants per product, summed".padEnd(36)} ${String(sumShown).padStart(10)} ${String(sumAccepts).padStart(10)} ${String(sumPlausible).padStart(10)}`);
  console.log(`  ${"products comparable (2+ shops)".padEnd(36)} ${String(comparableNow).padStart(10)} ${String(comparableAccepts).padStart(10)} ${String(comparablePlausible).padStart(10)}`);
  console.log(`  ${"products showing ONE shop".padEnd(36)} ${String(oneShopNow).padStart(10)}`);

  console.log(`\n  THE GAP:`);
  console.log(`    +${comparableAccepts - comparableNow} products the CURRENT RULES ALREADY ACCEPT` +
    `  (${(((comparableAccepts - comparableNow) / Math.max(1, targets.length)) * 100).toFixed(1)}% of targets)`);
  console.log(`     No model is needed for these. They are plumbing: the two rows never met.`);
  console.log(`    +${comparablePlausible - comparableAccepts} more that pass the pre-filter and the rules REFUSE` +
    `  (${(((comparablePlausible - comparableAccepts) / Math.max(1, targets.length)) * 100).toFixed(1)}%)`);
  console.log(`     This is the outer bound on what a judge could add, and it is an OUTER bound:`);
  console.log(`     the rules refuse most of them correctly. See the reason table below.`);

  // ── STEP 5. WHERE THE GAP LIVES. ────────────────────────────────────────────────────────
  const real = gapRows.filter((r) => r.verdict === "ACCEPTS");
  const byRoute = new Map<string, number>();
  for (const r of real) byRoute.set(r.route, (byRoute.get(r.route) ?? 0) + 1);
  const byMerchant = new Map<string, number>();
  for (const r of real) byMerchant.set(r.merchant, (byMerchant.get(r.merchant) ?? 0) + 1);

  console.log(`\n${"─".repeat(104)}`);
  console.log(`WHERE THE ACCEPTED GAP LIVES — ${real.length} (product, merchant) pairs the rules accept and we do not show`);
  console.log("─".repeat(104));
  console.log(`  BY ROUTE`);
  for (const [k, n] of [...byRoute.entries()].sort((a, b) => b[1] - a[1])) {
    const fix = k === "MIS-ATTACHED"
      ? "two catalog rows for one product -> consolidation"
      : "the store item never met this row  -> candidate selection";
    console.log(`    ${k.padEnd(14)} ${String(n).padStart(6)}   ${fix}`);
  }
  console.log(`\n  BY MERCHANT`);
  for (const [m, n] of [...byMerchant.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${m.padEnd(16)} ${String(n).padStart(6)}`);
  }

  // ── STEP 6. WHAT THE RULES REFUSED, AND WHY. This is the model's candidate space. ────────
  const refused = gapRows.filter((r) => r.verdict === "REFUSES");
  const elsewhere = gapRows.filter((r) => r.verdict === "BELONGS-ELSEWHERE");
  const byReason = new Map<string, number>();
  for (const r of refused) byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1);

  console.log(`\n${"─".repeat(104)}`);
  console.log(`WHAT THE RULES REFUSED — ${refused.length} pairs. THIS is what a model would be asked to judge.`);
  console.log("─".repeat(104));
  for (const [k, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(24)} ${String(n).padStart(6)}`);
  }
  console.log(`\n  Eight of them, to see what asking a model would mean:`);
  for (const r of refused.slice(0, 8)) {
    console.log(`    ${r.target.slice(0, 42).padEnd(42)} vs ${r.evidence.slice(0, 38).padEnd(38)} [${r.reason}]`);
  }
  console.log(`\n  ${elsewhere.length} further pairs were dropped by GATE 3: the offer already sits on a row it fits`);
  console.log(`  better. Counting those would have double-counted a shelf.`);

  // ── ONE FLAVOUR, TWO SPELLINGS. A defect, not a bound. ──────────────────────────────────
  const variantRefusals = refused.filter((r) => r.conflict);
  const synonymOnly = variantRefusals.filter((r) => r.synonymOnly);
  console.log(`\n${"─".repeat(104)}`);
  console.log(`A DEFECT INSIDE THE REFUSALS — the flavour class compares EXACTLY where everything else is fuzzy`);
  console.log("─".repeat(104));
  console.log(`  variant refusals with a stated conflict          ${variantRefusals.length}`);
  console.log(`  ...where the two values are the SAME FLAVOUR     ${synonymOnly.length}`);
  if (synonymOnly.length > 0) {
    for (const r of synonymOnly.slice(0, 10)) {
      console.log(`    [${r.conflict}]  ${r.target.slice(0, 40)}`);
      console.log(`      ${" ".repeat(Math.min(20, (r.conflict ?? "").length))}  ${r.evidence.slice(0, 52)}`);
    }
    console.log(`\n  These are hard REJECTs raised BEFORE scoring, so they never reach the review queue`);
    console.log(`  and no audit has ever seen them. CLAUDE.md: "Token equality is fuzzy:`);
    console.log(`  comprimate/compr., paprica/paprika. Treating those as distinct rejected`);
    console.log(`  genuinely identical products." The flavour class is the one place that does not.`);
  } else {
    console.log(`  none in this population.`);
  }

  // ── A SECOND DEFECT: `headNoun` RETURNS THE BRAND WHEN THE NAME LEADS WITH IT. ──────────
  //
  // `headNoun` is `sigTokens(nname)[0]` — the first significant token. For "BUCEGI Carne Porc
  // 300 g" that is `bucegi`, and `decide()`'s head-noun gate then demands the word "bucegi" in
  // the store's own name, BEFORE the brand gate ever runs. At a merchant that omits brands from
  // its names — Mega Image at 1.8%, Freshful at 2.2% — that is an automatic REJECT for reasons
  // that have nothing to do with what the product is. The gate is named for one job and doing
  // another.
  const brandFirst = targets.filter((t) => t.bTokens.includes(sigTokens(normalizeRo(t.name))[0] ?? ""));
  const headNounRefusals = refused.filter((r) => r.reason === "head-noun");
  const headNounBrandFirst = headNounRefusals.filter((r) => {
    const tt = targets.find((x) => x.slug === r.slug);
    return tt ? tt.bTokens.includes(sigTokens(normalizeRo(tt.name))[0] ?? "") : false;
  });
  console.log(`\n${"─".repeat(104)}`);
  console.log(`A SECOND DEFECT — the head-noun gate is comparing the BRAND at brand-first names`);
  console.log("─".repeat(104));
  console.log(`  targets whose first significant token IS the brand   ${brandFirst.length} of ${targets.length}` +
    `  (${((brandFirst.length / Math.max(1, targets.length)) * 100).toFixed(1)}%)`);
  console.log(`  head-noun refusals in total                          ${headNounRefusals.length}`);
  console.log(`  ...of them at a brand-first target                   ${headNounBrandFirst.length}` +
    `  (${((headNounBrandFirst.length / Math.max(1, headNounRefusals.length)) * 100).toFixed(1)}%)`);
  for (const r of headNounBrandFirst.slice(0, 6)) {
    console.log(`    ${r.target.slice(0, 44).padEnd(44)} vs ${r.evidence.slice(0, 44)}`);
  }
  console.log(`  A brand-first name at a brand-omitting merchant is refused before the brand gate`);
  console.log(`  can weigh in. The gate's own comment states the assumption: "RO names are`);
  console.log(`  noun-first". For 27% of branded grocery rows that is not so, and nothing checked.`);

  // ── WHAT THE FIX WOULD BE WORTH. A SIMULATION, run through the REAL `decide()`. ─────────
  //
  // The candidate change: the brand lives in its own column, so strip brand tokens out of the
  // NAME used for matching. `headNoun` then returns the actual noun, and the brand gate still
  // has `nbrand` to work with. Simulated by rewriting the catalog name and re-running the whole
  // pipeline — not by re-implementing one gate, which is how the descriptor work reported 2,097
  // and delivered 5.
  //
  // It also changes the overlap set, and deliberately: a brand token duplicated inside the name
  // inflates the score between two DIFFERENT products of the same brand. Whether that is an
  // improvement is a golden-set question, not this script's.
  // The survivors keep their ORIGINAL spelling. Normalising them here strips the "%" that
  // `doseTokens` reads out of `raw`, which turned the dose gate off and let this simulation
  // report `Iaurt grecesc 10%` matching `Iaurt grecesc 2%` as a win.
  const stripBrand = (name: string, bt: string[]): string =>
    String(name)
      .split(/\s+/)
      .filter((w) => !bt.includes(normalizeRo(w).replace(/[^a-z0-9]/g, "")))
      .join(" ");

  let wouldFlip = 0;
  const flipped: string[] = [];
  const targetBySlug = new Map(targets.map((t) => [t.slug, t]));
  for (const r of refused) {
    const t = targetBySlug.get(r.slug);
    if (!t) continue;
    const alt = stripBrand(t.name, t.bTokens);
    if (!alt.trim()) continue;
    const d = decide(
      prep(alt, t.brand, null), { unit: t.unit, unitSize: t.unitSize },
      prep(r.evidenceFull, t.brand, null), { unit: t.unit, unitSize: t.unitSize },
      "grocery",
    );
    if (d.ok) {
      wouldFlip++;
      if (flipped.length < 8) flipped.push(`    ${t.name.slice(0, 44).padEnd(44)} vs ${r.evidence.slice(0, 44)}`);
    }
  }
  console.log(`\n  SIMULATED FIX — strip brand tokens from the matching name, whole pipeline re-run:`);
  console.log(`    refused pairs re-decided        ${refused.length}`);
  console.log(`    now MATCH                       ${wouldFlip}`);
  for (const f of flipped) console.log(f);
  console.log(`  NOT APPLIED. A matcher change needs the golden set as referee and a full-catalog`);
  console.log(`  diff, per CLAUDE.md, and a false MATCH publishes one product's price on another.`);

  // ── STEP 7. THE BLIND SPOT, COUNTED. ────────────────────────────────────────────────────
  let invisible = 0;
  const invisibleBy = new Map<string, number>();
  for (const o of offers) {
    if (brandsOf(o).size === 0) {
      invisible++;
      invisibleBy.set(o.merchant, (invisibleBy.get(o.merchant) ?? 0) + 1);
    }
  }
  console.log(`\n${"─".repeat(104)}`);
  console.log(`THE BLIND SPOT — live grocery offers this measure CANNOT place`);
  console.log("─".repeat(104));
  console.log(`  no brand on the row AND no brand in the merchant's own name:  ${invisible} of ${offers.length}` +
    `  (${((invisible / Math.max(1, offers.length)) * 100).toFixed(1)}%)`);
  for (const [m, n] of [...invisibleBy.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
    console.log(`    ${m.padEnd(16)} ${String(n).padStart(6)}`);
  }
  console.log(`  Counted in NEITHER column. Every figure above is a FLOOR.`);

  // ── STEP 8. READ THESE. ─────────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(104)}`);
  console.log(`${Math.min(SAMPLE, real.length)} ACCEPTED GAP PAIRS TO READ — is each really the same product?`);
  console.log("─".repeat(104));
  for (const r of real.slice(0, SAMPLE)) {
    console.log(`  [${r.route}] ${r.merchant}  ${r.size}  score ${r.score}`);
    console.log(`     we show:  ${r.target.slice(0, 62)}`);
    console.log(`     they say: ${r.evidence}`);
    console.log(`     sitting on: ${r.onRow}`);
  }
  if (real.length === 0) console.log(`  NONE across ${targets.length} targets.`);

  console.log(`\n  A JUDGEMENT, not a measurement: whether each pair above is one product is a fact`);
  console.log(`  about what people buy, and per CLAUDE.md no query settles it. Read them.`);

  emitJson({
    targets: targets.length,
    eligibleRows: candidates.length,
    familiesCollapsed: byFamily.size,
    sumShown, sumAccepts, sumPlausible,
    comparableNow, comparableAccepts, comparablePlausible, oneShopNow,
    gapAccepted: comparableAccepts - comparableNow,
    gapRefusedCeiling: comparablePlausible - comparableAccepts,
    acceptedPairs: real.length,
    refusedPairs: refused.length,
    belongsElsewherePairs: elsewhere.length,
    byRoute: [...byRoute.entries()].map(([route, n]) => ({ route, n })),
    byMerchant: [...byMerchant.entries()].map(([merchant, n]) => ({ merchant, n })),
    byRefusalReason: [...byReason.entries()].map(([reason, n]) => ({ reason, n })),
    variantRefusalsWithConflict: variantRefusals.length,
    flavourSynonymRefusals: synonymOnly.length,
    brandFirstTargets: brandFirst.length,
    headNounRefusals: headNounRefusals.length,
    headNounRefusalsBrandFirst: headNounBrandFirst.length,
    simulatedStripBrandFlips: wouldFlip,
    blindSpotOffers: invisible,
    blindSpotShare: Number((invisible / Math.max(1, offers.length)).toFixed(4)),
    sample: real.slice(0, 200),
    pass: true,
  });
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
