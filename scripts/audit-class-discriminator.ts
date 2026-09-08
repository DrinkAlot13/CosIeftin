// IS THE 2x UNIT-PRICE SPREAD THE RIGHT FLAG FOR A BAD CLASS? Both instruments, side by side.
//
// THE CLAIM UNDER TEST. `audit:private-label-classes` flags a class whose members' unit prices
// differ by more than 2x. On the thirty private-label classes it fires on twenty. If most of
// those twenty are correct classes, the flag is not measuring what it is meant to measure, and
// a person reading twenty false alarms a night will stop reading them.
//
// THE ALTERNATIVE. When a group's prices disagree, ask WHICH WORDS separate the cheap half from
// the dear half — the test CLAUDE.md already prescribes for peer-relative checks, which says
// divergent store names are the cheapest available discriminator and do not depend on the
// prices at all. If the separating words are BRAND NAMES and PACK SIZES, the class is
// consistent and the gap is brand premium. If a PRODUCT-DEFINING word appears on one side only
// — `masline` against `floarea-soarelui`, `gura` against `izvor` — the class merged two things.
//
// ── HOW A TOKEN IS JUDGED, and the first attempt was wrong.
//
// Version one asked whether the token appears in the `Product.brand` column. That called
// `simpl`, `bilbor`, `yutto`, `olitalia`, `cornette` and `kitchin` product words, because those
// brands are not populated in the brand column for the products carrying them. A discriminator
// that depends on a column being filled in inherits that column's gaps.
//
// Version two asks a question the data can always answer: **how many DISTINCT BRANDS does this
// token appear alongside across the whole catalog?** A brand name appears with one brand — its
// own. A descriptive word (`integral`, `sarat`, `murate`, `gura`) appears with dozens, because
// dozens of brands describe their products with it. That needs no curation and no list.
//
//   npm run audit:discriminator            all 30 classes, both verdicts
//   npm run audit:discriminator -- --demo  what the token test caught that the spread did not

import { PrismaClient } from "@prisma/client";
import { membershipOk, rulesFromAttributes, type ClassRules } from "../src/lib/substitution/class-rules";

const prisma = new PrismaClient();

/** A token seen beside this many distinct brands or more is DESCRIPTIVE, not a brand. */
const DESCRIPTIVE_MIN_BRANDS = 4;

function toks(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[șş]/g, "s").replace(/[țţ]/g, "t").replace(/[ăâ]/g, "a").replace(/î/g, "i")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 2);
}

type Member = { id: number; name: string; unitSize: number; prices: { merchant: string; bani: number }[] };

/**
 * The seven merges the token test caught, expressed as the exclusions the fix ADDED.
 *
 * Rather than reconstruct seven whole pre-fix rule sets from memory — which would be a story,
 * not evidence — each entry names only the tokens that were added. `--demo` removes them from
 * the CURRENT rule, re-runs membership over the live catalog, and shows exactly which products
 * the old rule admitted. Computed, not remembered.
 */
const FIXES: { slug: string; added: string[]; what: string }[] = [
  { slug: "apa-carbogazoasa-05l", added: ["necarbogaz", "decarbogaz"], what: "`carbogaz` is a SUBSTRING match, so the token DEFINING the class also matched its own negation" },
  { slug: "apa-carbogazoasa-05l", added: ["afine", "menta", "lamaie", "capsuni", "zmeura", "portocale", "piersici", "ghimbir", "castravete"], what: "flavoured waters are not water" },
  { slug: "apa-plata-05l", added: ["afine", "menta", "lamaie", "capsuni", "zmeura", "portocale", "piersici", "ghimbir", "castravete"], what: "flavoured waters are not water" },
  { slug: "zahar-brun-500g", added: ["plic", "baghete", "stick", "melasa", "nerafinat", "dark", "crystals", "muscovado", "demerara"], what: "sachet packs stored as 500 g exactly like a bag, plus other sugars" },
  { slug: "ciuperci-intregi-conserva-280g", added: ["otet", "murate", "marar"], what: "PICKLED mushrooms, in vinegar with dill" },
  { slug: "croissant-cacao-85g", added: ["capsuni", "alune", "cocos", "padure", "dubla", "fistic", "lamaie"], what: "other fillings — the rule said `capsune`, the catalog writes `capsuni`" },
  { slug: "faina-alba-650-1kg", added: ["manitoba", "graham"], what: "Manitoba is a high-protein bread flour, not tip 650" },
  { slug: "fulgi-ovaz-500g", added: ["macinat", "faina", "tarate"], what: "ground oats are oat FLOUR, not oat flakes" },
];

async function main(): Promise<void> {
  const demo = process.argv.includes("--demo");
  const cutoff = new Date(Date.now() - 14 * 86_400_000);
  const live = {
    merchant: { active: true }, availability: "in stock", isStale: false, flagged: false,
    NOT: { priceSource: "DELIVERY_PLATFORM" }, lastObservedAt: { gte: cutoff },
  } as const;

  // ── The catalog's token vocabulary: token -> how many distinct brands use it.
  const catalog = await prisma.product.findMany({
    where: { section: "grocery", offers: { some: live } },
    select: { id: true, name: true, brand: true, unit: true, unitSize: true },
  });
  const brandsPerToken = new Map<string, Set<string>>();
  for (const p of catalog) {
    const b = (p.brand ?? "").trim().toLowerCase() || "(none)";
    for (const t of new Set(toks(p.name))) {
      const s = brandsPerToken.get(t) ?? new Set<string>();
      s.add(b);
      brandsPerToken.set(t, s);
    }
  }
  const descriptive = (t: string): boolean => (brandsPerToken.get(t)?.size ?? 0) >= DESCRIPTIVE_MIN_BRANDS;

  const classes = await prisma.equivalenceClass.findMany({ orderBy: { slug: "asc" } });
  const strict = classes.filter((c) => rulesFromAttributes(c.attributes).strictRules === true);

  const assigned = await prisma.product.findMany({
    where: { equivalenceClassId: { in: strict.map((c) => c.id) } },
    select: {
      id: true, name: true, unitSize: true, equivalenceClassId: true,
      offers: { where: live, select: { priceBani: true, merchant: { select: { slug: true } } } },
    },
  });
  const byClass = new Map<number, Member[]>();
  for (const p of assigned) {
    const prices = p.offers.filter((o) => o.priceBani != null && o.priceBani > 0)
      .map((o) => ({ merchant: o.merchant.slug, bani: o.priceBani as number }));
    if (!prices.length) continue;
    byClass.set(p.equivalenceClassId!, [...(byClass.get(p.equivalenceClassId!) ?? []), { id: p.id, name: p.name, unitSize: p.unitSize, prices }]);
  }

  type Verdict = { slug: string; spread: number; spreadFlag: boolean; tokenFlag: boolean; cheapWords: string[]; dearWords: string[]; members: Member[]; unit: string };
  const verdicts: Verdict[] = [];

  for (const c of strict) {
    const members = byClass.get(c.id) ?? [];
    const unitPrices = members.flatMap((m) => m.prices.map((p) => ({ name: m.name, perUnit: p.bani / 100 / m.unitSize })));
    if (unitPrices.length === 0) continue;
    const lo = Math.min(...unitPrices.map((u) => u.perUnit));
    const hi = Math.max(...unitPrices.map((u) => u.perUnit));
    const spread = lo > 0 ? hi / lo : 0;
    const mid = (lo + hi) / 2;
    const cheapToks = new Set(unitPrices.filter((u) => u.perUnit <= mid).flatMap((u) => toks(u.name)));
    const dearToks = new Set(unitPrices.filter((u) => u.perUnit > mid).flatMap((u) => toks(u.name)));
    const onlyCheap = [...cheapToks].filter((t) => !dearToks.has(t) && descriptive(t) && !/^\d/.test(t));
    const onlyDear = [...dearToks].filter((t) => !cheapToks.has(t) && descriptive(t) && !/^\d/.test(t));
    verdicts.push({
      slug: c.slug, spread, spreadFlag: spread > 2,
      tokenFlag: onlyCheap.length + onlyDear.length > 0,
      cheapWords: onlyCheap, dearWords: onlyDear, members, unit: c.unit,
    });
  }

  console.log("═".repeat(112));
  console.log("THE TWO INSTRUMENTS, SIDE BY SIDE — 30 private-label classes");
  console.log("═".repeat(112));
  console.log(`  ${"class".padEnd(34)} ${"spread".padStart(7)} ${"spread?".padStart(8)} ${"token?".padStart(7)}  separating PRODUCT words (brands and sizes filtered out)`);
  for (const v of verdicts.sort((a, b) => b.spread - a.spread)) {
    const words = [...v.cheapWords.map((w) => `-${w}`), ...v.dearWords.map((w) => `+${w}`)].slice(0, 8).join(" ");
    console.log(`  ${v.slug.padEnd(34)} ${v.spread.toFixed(2).padStart(6)}x ${(v.spreadFlag ? "FLAG" : "ok").padStart(8)} ${(v.tokenFlag ? "FLAG" : "ok").padStart(7)}  ${words}`);
  }

  const bothFlag = verdicts.filter((v) => v.spreadFlag && v.tokenFlag);
  const spreadOnly = verdicts.filter((v) => v.spreadFlag && !v.tokenFlag);
  const tokenOnly = verdicts.filter((v) => !v.spreadFlag && v.tokenFlag);
  const neither = verdicts.filter((v) => !v.spreadFlag && !v.tokenFlag);
  console.log(`\n  spread flags ${verdicts.filter((v) => v.spreadFlag).length}/${verdicts.length} · token flags ${verdicts.filter((v) => v.tokenFlag).length}/${verdicts.length}`);
  console.log(`  both ${bothFlag.length} · spread ONLY ${spreadOnly.length} · token ONLY ${tokenOnly.length} · neither ${neither.length}`);

  console.log(`\n${"─".repeat(112)}\nFLAGGED BY SPREAD, CLEARED BY THE TOKEN TEST — the false alarms, with their members\n${"─".repeat(112)}`);
  for (const v of spreadOnly.sort((a, b) => b.spread - a.spread)) {
    console.log(`\n  ${v.slug}   spread ${v.spread.toFixed(2)}x — every separating word is a brand or a size`);
    const rows = v.members.flatMap((m) => m.prices.map((p) => ({ n: m.name, s: m.unitSize, m: p.merchant, per: p.bani / 100 / m.unitSize })))
      .sort((a, b) => a.per - b.per);
    for (const r of [rows[0], rows[rows.length - 1]]) {
      console.log(`      ${r.per.toFixed(2).padStart(7)}/${v.unit}  ${r.m.padEnd(12)} ${r.n.slice(0, 56)}`);
    }
    console.log(`      (${rows.length} priced rows; cheapest and dearest shown)`);
  }

  if (tokenOnly.length) {
    console.log(`\n${"─".repeat(112)}\nFLAGGED BY THE TOKEN TEST, MISSED BY SPREAD — a merge the price gap did not reveal\n${"─".repeat(112)}`);
    for (const v of tokenOnly) {
      console.log(`\n  ${v.slug}   spread only ${v.spread.toFixed(2)}x, but the halves are separated by:`);
      console.log(`      cheaper half only: ${v.cheapWords.join(" ") || "—"}`);
      console.log(`      dearer  half only: ${v.dearWords.join(" ") || "—"}`);
    }
  }

  // ── What the token test caught that the spread never could ────────────────────
  if (demo) {
    console.log(`\n${"═".repeat(112)}`);
    console.log("WHAT THE TOKEN TEST CAUGHT — each fix, re-evaluated against the live catalog");
    console.log("Removing the exclusions the fix added, and listing the products the OLD rule admitted.");
    console.log("═".repeat(112));
    const bySlug = new Map(classes.map((c) => [c.slug, c]));
    for (const f of FIXES) {
      const c = bySlug.get(f.slug);
      if (!c) continue;
      const rules = rulesFromAttributes(c.attributes);
      const relaxed: ClassRules = { ...rules, exclude: (rules.exclude ?? []).filter((e) => !f.added.includes(e)) };
      const admitted = catalog.filter((p) => {
        if (p.unit !== c.unit) return false;
        if (rules.minUnitSize != null && p.unitSize < rules.minUnitSize) return false;
        if (rules.maxUnitSize != null && p.unitSize > rules.maxUnitSize) return false;
        return membershipOk(p.name, relaxed).ok && !membershipOk(p.name, rules).ok;
      });
      console.log(`\n  ${f.slug}  +[${f.added.join(" ")}]`);
      console.log(`    ${f.what}`);
      if (admitted.length === 0) { console.log(`    (the old rule admitted nothing extra in today's catalog)`); continue; }
      console.log(`    the OLD rule admitted ${admitted.length} product(s) the new one refuses:`);
      for (const p of admitted.slice(0, 6)) console.log(`      ${`${p.unitSize}${p.unit}`.padEnd(9)} ${p.name.slice(0, 74)}`);
      if (admitted.length > 6) console.log(`      … and ${admitted.length - 6} more`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
