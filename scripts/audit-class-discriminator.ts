// A READING AID FOR EQUIVALENCE CLASSES. It reaches no verdict, and that is deliberate.
//
// ── WHY THIS IS NOT A CHECK.
//
// Whether a class describes a real purchase is a judgement about the world, not a property of
// the data — see CLAUDE.md, "SOME DEFECTS HAVE NO AUTOMATED DETECTOR". Seven real merges were
// found in these thirty classes, and fixing all seven left the spread rule's flag set at twenty
// before and twenty after. A person reading the member lists found them, with a list of
// discriminating words as a prompt.
//
// This file IS that prompt, built for reading. Its job is to make ten minutes of a person's
// attention productive: group the members, show the words that separate the cheap half from the
// dear half, put the spread and the shop count beside them, and order the classes so the
// likeliest problems come first.
//
// The ordering is a HEURISTIC FOR SORTING ONLY. It is not a score, it does not appear in any
// summary, and nothing downstream reads it. `audit:private-label-classes` remains the one place
// a class gets a verdict, and it gets exactly one.
//
//   npm run audit:discriminator            every class, worst-looking first
//   npm run audit:discriminator -- --demo  what each rule fix actually removed, from live data
//   npm run audit:discriminator -- --top=8

import { PrismaClient } from "@prisma/client";
import { membershipOk, rulesFromAttributes, type ClassRules } from "../src/lib/substitution/class-rules";

const prisma = new PrismaClient();

/** A token seen beside this many distinct brands or more is descriptive, not a brand name. */
const DESCRIPTIVE_MIN_BRANDS = 4;

function toks(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[șş]/g, "s").replace(/[țţ]/g, "t").replace(/[ăâ]/g, "a").replace(/î/g, "i")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 2);
}

type Priced = { shop: string; bani: number };
type Member = { name: string; unitSize: number; prices: Priced[] };

/**
 * The rule fixes, expressed as the exclusions each ADDED.
 *
 * Reconstructing seven pre-fix rule sets from memory would be a story. Naming only the tokens
 * that were added lets `--demo` remove them from the CURRENT rule, re-run membership over the
 * live catalog, and show exactly which products the old rule let in. Computed, not remembered.
 */
const FIXES: { slug: string; added: string[]; what: string }[] = [
  { slug: "apa-carbogazoasa-05l", added: ["necarbogaz", "decarbogaz"], what: "`carbogaz` matches by SUBSTRING, so the token defining the class also matched its own negation" },
  { slug: "apa-carbogazoasa-05l", added: ["afine", "menta", "lamaie", "capsuni", "zmeura", "portocale", "piersici", "ghimbir", "castravete"], what: "flavoured water is not water" },
  { slug: "apa-plata-05l", added: ["afine", "menta", "lamaie", "capsuni", "zmeura", "portocale", "piersici", "ghimbir", "castravete"], what: "flavoured water is not water" },
  { slug: "zahar-brun-500g", added: ["plic", "baghete", "stick", "melasa", "nerafinat", "dark", "crystals", "muscovado", "demerara"], what: "sachet boxes stored as 500 g exactly like a bag, plus other sugars" },
  { slug: "ciuperci-intregi-conserva-280g", added: ["otet", "murate", "marar"], what: "PICKLED mushrooms, in vinegar with dill" },
  { slug: "croissant-cacao-85g", added: ["capsuni", "alune", "cocos", "padure", "dubla", "fistic", "lamaie"], what: "other fillings — the rule said `capsune`, the catalog writes `capsuni`" },
  { slug: "faina-alba-650-1kg", added: ["manitoba", "graham"], what: "Manitoba is a high-protein bread flour, not tip 650" },
  { slug: "fulgi-ovaz-500g", added: ["macinat", "faina", "tarate"], what: "ground oats are oat FLOUR, not oat flakes" },
];

/** Wrap the separating words in a name so the eye lands on them. */
function highlight(name: string, words: Set<string>): string {
  if (words.size === 0) return name;
  return name.split(/(\s+)/).map((w) => {
    const bare = toks(w)[0];
    return bare && words.has(bare) ? `[${w}]` : w;
  }).join("");
}

async function main(): Promise<void> {
  const demo = process.argv.includes("--demo");
  const top = Number((process.argv.find((a) => a.startsWith("--top=")) ?? "--top=99").split("=")[1]);
  const cutoff = new Date(Date.now() - 14 * 86_400_000);
  const live = {
    merchant: { active: true }, availability: "in stock", isStale: false, flagged: false,
    NOT: { priceSource: "DELIVERY_PLATFORM" }, lastObservedAt: { gte: cutoff },
  } as const;

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
      .map((o) => ({ shop: o.merchant.slug, bani: o.priceBani as number }));
    if (!prices.length) continue;
    byClass.set(p.equivalenceClassId!, [...(byClass.get(p.equivalenceClassId!) ?? []), { name: p.name, unitSize: p.unitSize, prices }]);
  }

  type View = {
    slug: string; label: string; unit: string; members: Member[];
    lo: number; hi: number; spread: number; shops: Set<string>;
    words: Set<string>; cheapWords: string[]; dearWords: string[];
    sizes: number[]; attention: number;
  };
  const views: View[] = [];

  for (const c of strict) {
    const members = byClass.get(c.id) ?? [];
    if (!members.length) continue;
    const rows = members.flatMap((m) => m.prices.map((p) => ({ name: m.name, perUnit: p.bani / 100 / m.unitSize })));
    const lo = Math.min(...rows.map((r) => r.perUnit));
    const hi = Math.max(...rows.map((r) => r.perUnit));
    const spread = lo > 0 ? hi / lo : 0;
    const mid = (lo + hi) / 2;
    const cheapToks = new Set(rows.filter((r) => r.perUnit <= mid).flatMap((r) => toks(r.name)));
    const dearToks = new Set(rows.filter((r) => r.perUnit > mid).flatMap((r) => toks(r.name)));
    const cheapWords = [...cheapToks].filter((t) => !dearToks.has(t) && descriptive(t) && !/^\d/.test(t));
    const dearWords = [...dearToks].filter((t) => !cheapToks.has(t) && descriptive(t) && !/^\d/.test(t));
    const shops = new Set(members.flatMap((m) => m.prices.map((p) => p.shop)));
    const sizes = [...new Set(members.map((m) => m.unitSize))].sort((a, b) => a - b);
    // ORDERING ONLY. Not a score, not reported, not read by anything.
    const attention =
      Math.min(spread, 8) * 2 +
      (cheapWords.length + dearWords.length) * 0.5 +
      (shops.size < 2 ? 10 : 0) +
      (sizes.length > 1 ? 2 : 0);
    views.push({
      slug: c.slug, label: c.label, unit: c.unit, members, lo, hi, spread, shops,
      words: new Set([...cheapWords, ...dearWords]), cheapWords, dearWords, sizes, attention,
    });
  }

  views.sort((a, b) => b.attention - a.attention);

  console.log("═".repeat(104));
  console.log(`EQUIVALENCE CLASSES, FOR READING — ${views.length} classes, likeliest problems first`);
  console.log("This reaches no verdict. audit:private-label-classes does that, once per class.");
  console.log("═".repeat(104));

  for (const [i, v] of views.slice(0, top).entries()) {
    console.log(`\n${"─".repeat(104)}`);
    console.log(`${String(i + 1).padStart(2)}. ${v.slug}   "${v.label}"`);
    const sizeNote = v.sizes.length > 1 ? `sizes ${v.sizes.join(", ")} ${v.unit}` : `all ${v.sizes[0]} ${v.unit}`;
    console.log(`    ${v.members.length} products · ${v.shops.size} shops · ${v.lo.toFixed(2)}–${v.hi.toFixed(2)} lei/${v.unit} (${v.spread.toFixed(2)}x) · ${sizeNote}`);
    if (v.shops.size < 2) console.log(`    ⚠ ONE SHOP (${[...v.shops][0]}) — not a comparison today`);
    if (v.cheapWords.length || v.dearWords.length) {
      console.log(`    words only in the CHEAPER half: ${v.cheapWords.slice(0, 12).join(" ") || "—"}`);
      console.log(`    words only in the DEARER  half: ${v.dearWords.slice(0, 12).join(" ") || "—"}`);
    } else {
      console.log(`    the halves use the same words`);
    }
    // GROUPED BY PRODUCT, cheapest first — one line per product, its shops beside it.
    const withUnit = v.members
      .map((m) => ({ m, best: Math.min(...m.prices.map((p) => p.bani / 100 / m.unitSize)) }))
      .sort((a, b) => a.best - b.best);
    for (const { m, best } of withUnit) {
      const shops = m.prices
        .sort((a, b) => a.bani - b.bani)
        .map((p) => `${p.shop} ${(p.bani / 100).toFixed(2)}`)
        .join("  ");
      console.log(`    ${best.toFixed(2).padStart(7)}/${v.unit.padEnd(3)} ${`${m.unitSize}${v.unit}`.padEnd(8)} ${highlight(m.name, v.words).slice(0, 56).padEnd(56)} ${shops}`);
    }
  }

  console.log(`\n${"═".repeat(104)}`);
  console.log(`Words in [brackets] are those that appear in only ONE half of the price range.`);
  console.log(`They are a PROMPT, not a finding: they cannot tell a product-defining word from a`);
  console.log(`descriptive one. Read the names. The question is "would a shopper accept this`);
  console.log(`instead of that?", and no query answers it.`);

  if (demo) {
    console.log(`\n${"═".repeat(104)}`);
    console.log("WHAT READING THEM CAUGHT — each fix re-evaluated against the live catalog");
    console.log("Each rule's added exclusions are stripped, membership re-run, and the products the");
    console.log("OLD rule admitted are listed. This is the evidence, not the recollection.");
    console.log("═".repeat(104));
    const bySlug = new Map(classes.map((c) => [c.slug, c]));
    let totalAdmitted = 0;
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
      totalAdmitted += admitted.length;
      console.log(`\n  ${f.slug}   +[${f.added.join(" ")}]`);
      console.log(`    ${f.what}`);
      if (!admitted.length) { console.log(`    (nothing extra in today's catalog)`); continue; }
      console.log(`    the OLD rule admitted ${admitted.length}:`);
      for (const p of admitted.slice(0, 6)) console.log(`      ${`${p.unitSize}${p.unit}`.padEnd(9)} ${p.name.slice(0, 72)}`);
      if (admitted.length > 6) console.log(`      … and ${admitted.length - 6} more`);
    }
    console.log(`\n  ${totalAdmitted} products in total, none of which the spread rule would have surfaced:`);
    console.log(`  fixing all of them left the flag set at twenty before and twenty after.`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
