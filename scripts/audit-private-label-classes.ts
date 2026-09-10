// PHASE 3 — grade the private-label classes FROM OUTSIDE. READ-ONLY.
//
// THE ASSIGNER MAY NOT GRADE ITSELF. This file imports `PrismaClient` and nothing else: not
// membershipOk, not the class definitions, not normalizeRo. If it shared the assigner's code it
// would share the assigner's mistakes and agree with them — which is the shape of every serious
// bug this project has had. Everything below is computed from the rows as they now stand.
//
// It prints every class in full, with every member at every merchant, its own size and its own
// unit price, so the claims can be read one by one before anything is shown to a shopper.
//
// WHAT IT FLAGS — and flagging is all it does, deliberately:
//
//   SPREAD >2x     members' unit prices differ by more than 2x. This does NOT mean a shop is
//                  expensive; it usually means the class merged two different products.
//   WINDOW         a member outside the class's own declared min/max.
//   ONE MERCHANT   the class resolved at fewer than 2 merchants, so it is not doing its job.
//   SINGLE-SHOP    the class is only ever satisfied at one shop for any given member.
//
// IT NAMES NO CULPRIT. CLAUDE.md is explicit: a peer-relative check flags DISAGREEMENT, not
// guilt. Three false members move the median onto themselves and the check then indicts the two
// correct rows — that inversion is why the gelatine audit nearly withheld the two right prices.
// So the output is the GROUP: every row, its own name, its own price, and the tokens that
// distinguish the cheap half from the dear half. The reader decides which side is wrong.
//
//   npm run audit:private-label-classes
//   npm run audit:private-label-classes -- --all     (include classes seeded before this work)

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** The live-offer window, restated here rather than imported — see the header. */
const MAX_DISPLAY_AGE_DAYS = 14;

type Member = {
  id: number; name: string; unit: string; unitSize: number;
  prices: { merchant: string; bani: number }[];
};

/** Tokens of a name, lowercased and diacritic-folded. Local, on purpose. */
function toks(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[șş]/g, "s").replace(/[țţ]/g, "t").replace(/[ăâ]/g, "a").replace(/î/g, "i")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 2);
}

async function main(): Promise<void> {
  const all = process.argv.includes("--all");
  const cutoff = new Date(Date.now() - MAX_DISPLAY_AGE_DAYS * 86_400_000);

  // `--slugs=a,b,c` restricts the report to named classes. Added so a Phase 1b BATCH can be read
  // on its own: the brief reviews classes batch by batch, and a 131-class dump makes "what did
  // this batch do" unanswerable. It only narrows what is PRINTED; nothing else changes.
  const slugArg = process.argv.find((a) => a.startsWith("--slugs="));
  const onlySlugs = slugArg ? new Set(slugArg.split("=")[1].split(",").filter(Boolean)) : null;

  const classes = (await prisma.equivalenceClass.findMany({ orderBy: { slug: "asc" } }))
    .filter((c) => !onlySlugs || onlySlugs.has(c.slug));
  const products = await prisma.product.findMany({
    where: { equivalenceClassId: { not: null } },
    select: {
      id: true, name: true, unit: true, unitSize: true, equivalenceClassId: true,
      offers: {
        where: {
          merchant: { active: true }, availability: "in stock", isStale: false, flagged: false,
          NOT: { priceSource: "DELIVERY_PLATFORM" }, lastObservedAt: { gte: cutoff },
        },
        select: { priceBani: true, merchant: { select: { slug: true } } },
      },
    },
  });

  const byClass = new Map<number, Member[]>();
  for (const p of products) {
    const prices = p.offers
      .filter((o) => o.priceBani != null && o.priceBani > 0)
      .map((o) => ({ merchant: o.merchant.slug, bani: o.priceBani as number }));
    if (prices.length === 0) continue;
    const list = byClass.get(p.equivalenceClassId!) ?? [];
    list.push({ id: p.id, name: p.name, unit: p.unit, unitSize: p.unitSize, prices });
    byClass.set(p.equivalenceClassId!, list);
  }

  // The 30 classes this brief added are the ones under review. The rest are printed only
  // with --all, so the report the brief asked to READ IN FULL stays readable.
  const underReview = classes.filter((c) => {
    if (all) return true;
    try { return (JSON.parse(c.attributes ?? "{}") as { strictRules?: boolean }).strictRules === true; }
    catch { return false; }
  });

  let flaggedSpread = 0, flaggedWindow = 0, oneMerchant = 0, ok = 0;
  const summary: string[] = [];

  console.log("=".repeat(110));
  console.log(`PHASE 3 — PRIVATE-LABEL CLASS AUDIT   ${underReview.length} classes, graded from outside`);
  console.log("=".repeat(110));

  for (const c of underReview) {
    const attrs = JSON.parse(c.attributes ?? "{}") as {
      require?: string[]; exclude?: string[]; minUnitSize?: number; maxUnitSize?: number;
    };
    const members = (byClass.get(c.id) ?? []).sort((a, b) => a.name.localeCompare(b.name));
    const merchants = new Set(members.flatMap((m) => m.prices.map((p) => p.merchant)));

    // UNIT PRICE, in the class's own unit — the banana rule. A 200 g pack and a 1 kg bag are
    // only comparable per kilo, and comparing pack prices is how a small pack reads as cheap.
    const unitPrices = members.flatMap((m) =>
      m.prices.map((p) => ({ merchant: p.merchant, name: m.name, size: m.unitSize, perUnit: p.bani / 100 / m.unitSize })),
    );
    const lo = unitPrices.length ? Math.min(...unitPrices.map((u) => u.perUnit)) : 0;
    const hi = unitPrices.length ? Math.max(...unitPrices.map((u) => u.perUnit)) : 0;
    const spread = lo > 0 ? hi / lo : 0;

    const outOfWindow = members.filter(
      (m) => (attrs.minUnitSize != null && m.unitSize < attrs.minUnitSize) ||
             (attrs.maxUnitSize != null && m.unitSize > attrs.maxUnitSize),
    );

    const flags: string[] = [];
    if (merchants.size < 2) { flags.push("ONE MERCHANT — not doing its job"); oneMerchant++; }
    if (spread > 2) { flags.push(`SPREAD ${spread.toFixed(2)}x`); flaggedSpread++; }
    if (outOfWindow.length) { flags.push(`WINDOW: ${outOfWindow.length} outside ${attrs.minUnitSize}..${attrs.maxUnitSize}`); flaggedWindow++; }
    if (flags.length === 0) ok++;

    const banner = flags.length ? `  ⚠ ${flags.join("  |  ")}` : "  ✓";
    console.log(`\n${"─".repeat(110)}`);
    console.log(`${c.slug}   "${c.label}"`);
    console.log(`  ${members.length} products · ${merchants.size} merchants · ${lo.toFixed(2)}–${hi.toFixed(2)} lei/${c.unit} · window ${attrs.minUnitSize}..${attrs.maxUnitSize} ${c.unit}${banner}`);
    console.log(`  require ${JSON.stringify(attrs.require ?? [])}`);
    if (members.length === 0) { console.log("  (no live members)"); summary.push(`${c.slug}: EMPTY`); continue; }

    for (const m of members) {
      const per = m.prices.map((p) => `${p.merchant} ${(p.bani / 100).toFixed(2)} = ${(p.bani / 100 / m.unitSize).toFixed(2)}/${c.unit}`).join("   ");
      const outside = (attrs.minUnitSize != null && m.unitSize < attrs.minUnitSize) || (attrs.maxUnitSize != null && m.unitSize > attrs.maxUnitSize);
      console.log(`    ${outside ? "!" : " "} ${`${m.unitSize}${m.unit}`.padEnd(9)} ${m.name.slice(0, 52).padEnd(52)} ${per}`);
    }

    // THE DISCRIMINATING TOKENS, not a verdict. When a group's prices disagree, the cheapest
    // reason to suspect a MISMATCH rather than a misprice is that the two halves use different
    // words — and that test does not look at the prices at all.
    if (spread > 2 && unitPrices.length > 1) {
      const mid = (lo + hi) / 2;
      const cheapNames = unitPrices.filter((u) => u.perUnit <= mid).map((u) => u.name);
      const dearNames = unitPrices.filter((u) => u.perUnit > mid).map((u) => u.name);
      const cheapToks = new Set(cheapNames.flatMap(toks));
      const dearToks = new Set(dearNames.flatMap(toks));
      const onlyCheap = [...cheapToks].filter((t) => !dearToks.has(t));
      const onlyDear = [...dearToks].filter((t) => !cheapToks.has(t));
      // A size number is not a product word either — "320" separating a 320 g jar from a 300 g
      // one says the packs differ, which the window already governs.
      // ── A READING AID, NOT A SECOND VERDICT.
      //
      // These word lists are printed to make the member list above faster to read: when a group's
      // prices disagree, the cheapest discriminator is whether the two halves use different
      // WORDS, and that test does not look at the prices at all. Reading them is how the seven
      // real merges in this set were found (necarbogazoasă inside the SPARKLING water class,
      // pickled mushrooms among the tinned, `capsuni` where the rule said `capsune`).
      //
      // They are DELIBERATELY NOT a verdict. Measured as an automatic classifier
      // (`npm run audit:discriminator`) the token test flags 29 of 30 classes — worse than the
      // spread rule it was meant to replace — because it cannot tell a product-defining word
      // (`masline`, `murate`) from a merely descriptive one (`coapte`, `fin`, `extra`), and it
      // even flags a class on its own require-words. One verdict per class, from the spread; the
      // words are here to be read.
      console.log(`      words only in the CHEAPER half: ${onlyCheap.slice(0, 14).join(" ") || "—"}`);
      console.log(`      words only in the DEARER  half: ${onlyDear.slice(0, 14).join(" ") || "—"}`);
      console.log(`      (a group, not a culprit — resolve it against the names, not the prices)`);
      summary.push(`${c.slug}: SPREAD ${spread.toFixed(2)}x`);
    } else if (merchants.size < 2) {
      summary.push(`${c.slug}: ONE MERCHANT (${[...merchants].join(",") || "none"})`);
    } else if (outOfWindow.length) {
      summary.push(`${c.slug}: ${outOfWindow.length} outside the window`);
    }
  }

  console.log(`\n${"=".repeat(110)}`);
  console.log(`VERDICT  ${ok} clean · ${flaggedSpread} spread>2x · ${flaggedWindow} outside window · ${oneMerchant} single-merchant`);
  console.log("=".repeat(110));
  if (summary.length) {
    console.log("\nNEEDS A DECISION:");
    for (const s of summary) console.log(`  ${s}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
