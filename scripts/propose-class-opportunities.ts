// ── PHASE 1a: WHERE WOULD THE NEXT EQUIVALENCE CLASSES PAY MOST? READ-ONLY.
//
// 131 classes exist and contribute +1,069 comparable-or-equivalent products — the largest single
// gain anything has produced. This finds where the NEXT ones would go, and it is a READING AID,
// not a proposer: it writes nothing, assigns nothing, and reaches no verdict about whether any
// group is a real equivalence.
//
// CLAUDE.md is explicit that this is the correct posture. "Whether an equivalence class describes
// a real purchase is a judgement about the world, not a property of the data" — no query can tell
// you that sparkling water is not still water, or that Manitoba flour is not tip 650. An audit's
// job is to make a person's ten minutes productive, then stop. So the output is groups, members,
// discriminators and prices, sorted so the likeliest wins come first.
//
// ── HOW A GROUP IS FORMED.
//
//   head noun   `scrape-util.headNoun`, the ONE implementation, and brand-aware because 27.2% of
//               branded grocery rows lead with their brand. Restating it here would be the exact
//               defect `check:concepts` exists to catch.
//   size window bucketed by canonical unit, so 500 g and 1 kg cannot land in one group. A group
//               that spans a size boundary is not a candidate class, it is two.
//
// ── WHY THE RANKING IS (DISTINCT MERCHANTS × PRODUCTS) AND NOT PRODUCT COUNT.
//
// A class only pays when it resolves to TWO OR MORE merchants — that is what makes it a
// comparison. 40 products from one shop is worth nothing; 6 products across 4 shops is worth a
// lot. Ranking on products alone would put every private-label monoculture at the top.
//
// ── WHAT IS EXCLUDED, AND WHY THAT IS NOT THE SAME AS "ALREADY DONE".
//
// A group is dropped when a majority of its members already sit in an equivalence class. Partial
// overlap is REPORTED rather than dropped, because a class that catches 3 of 11 members is a
// class whose window or rules are too tight — which is a finding, not a non-opportunity.
//
//   npm run propose:class-opportunities
//   npm run propose:class-opportunities -- --top=200 --min-merchants=2

import { PrismaClient } from "@prisma/client";
import { headNoun } from "../src/lib/scrape-util";
import { normalizeRo } from "../src/lib/text/normalizeRo";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();

/**
 * Size buckets, per canonical unit.
 *
 * Deliberately NOT a tolerance percentage — the brief forbids one and CLAUDE.md's produce work
 * says why: a percentage band around 1 kg swallows 1,25 kg but not 0,8 kg, which is arbitrary in
 * a way a shopper would not recognise. These are the sizes Romanian grocery actually ships in.
 */
const BUCKETS: Record<string, number[]> = {
  kg: [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.75, 1, 1.5, 2, 3, 5, 10],
  l: [0.2, 0.25, 0.33, 0.5, 0.75, 1, 1.5, 2, 2.5, 5],
  buc: [1, 2, 4, 6, 8, 10, 12, 20, 30, 100],
};

/** The bucket a size falls in, as a label. Returns null when the unit is unknown. */
function bucketOf(unit: string | null, size: number | null): string | null {
  if (!unit || size == null || size <= 0) return null;
  const u = unit.toLowerCase();
  const edges = BUCKETS[u];
  if (!edges) return null;
  // nearest edge, but never more than 25% away — a 7 kg sack is not "5 kg"
  let best = edges[0];
  for (const e of edges) if (Math.abs(e - size) < Math.abs(best - size)) best = e;
  if (Math.abs(best - size) > best * 0.25) return null;
  return `${best}${u}`;
}

const bani = (n: number | null | undefined) => (n == null ? "—" : `${(n / 100).toFixed(2)}`);

type Member = {
  id: number;
  name: string;
  brand: string | null;
  unit: string | null;
  unitSize: number | null;
  merchants: string[];
  priceBani: number | null;
  unitPriceBani: number | null;
  classSlug: string | null;
};

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const num = (flag: string, dflt: number) =>
    Number((argv.find((a) => a.startsWith(`--${flag}=`)) ?? `--${flag}=${dflt}`).split("=")[1]);
  const TOP = num("top", 200);
  const MIN_MERCHANTS = num("min-merchants", 2);

  const live = { merchant: { active: true }, isStale: false, flagged: false };

  const products = await prisma.product.findMany({
    where: { section: "grocery", offers: { some: live } },
    select: {
      id: true, name: true, brand: true, unit: true, unitSize: true,
      equivalenceClass: { select: { slug: true } },
      offers: {
        where: live,
        select: { priceBani: true, merchant: { select: { slug: true } } },
      },
    },
  });

  if (products.length === 0) {
    console.error("No live grocery products. Checked nothing — a FAILURE, not a pass.");
    emitJson({ pass: false, reason: "no-population" });
    await prisma.$disconnect();
    process.exit(1);
  }

  // ── THE BRAND SET, DERIVED FROM THE CATALOG RATHER THAN LISTED BY HAND ───────────────────
  //
  // `headNoun` is brand-aware and correct: given brand="Palmolive" it returns "gel", not
  // "palmolive". But it can only skip a brand it is TOLD about, and 39.6% of live grocery
  // products carry no `brand` field at all — Sezamo and the Glovo storefronts largely do not
  // populate one. For those, the leading token IS the brand, and the group becomes "every Alpro
  // 1 l product" instead of "every plant drink 1 l".
  //
  // That is a brand FAMILY, which CLAUDE.md names as the exact thing a class must not be: one
  // Nivea shower gel once backed 17 products across three merchants. Such a group also scores
  // WELL, because a widely-stocked brand spans many shops — so it floats to the top of precisely
  // the list a person is meant to read first.
  //
  // The brand vocabulary is taken from the products that DO declare one. No hand-written list:
  // that would be a second implementation of "what is a brand", and it would go stale.
  const brandRows = await prisma.product.findMany({
    where: { section: "grocery", brand: { not: null } },
    select: { brand: true },
    distinct: ["brand"],
  });
  const knownBrands = new Set(
    brandRows.map((b) => normalizeRo(b.brand ?? "")).filter((b) => b.length >= 3),
  );

  // ── group ────────────────────────────────────────────────────────────────────────────────
  const groups = new Map<string, Member[]>();
  let unbucketed = 0;
  for (const p of products) {
    const bucket = bucketOf(p.unit, p.unitSize);
    if (!bucket) { unbucketed++; continue; }
    const hn = headNoun(normalizeRo(p.name), normalizeRo(p.brand ?? ""));
    if (!hn || hn.length < 3) { unbucketed++; continue; }
    const key = `${hn}|${bucket}`;

    const prices = p.offers.map((o) => o.priceBani).filter((x): x is number => x != null);
    const priceBani = prices.length ? Math.min(...prices) : null;
    const m: Member = {
      id: p.id, name: p.name, brand: p.brand, unit: p.unit, unitSize: p.unitSize,
      merchants: [...new Set(p.offers.map((o) => o.merchant.slug))],
      priceBani,
      unitPriceBani: priceBani != null && p.unitSize ? Math.round(priceBani / p.unitSize) : null,
      classSlug: p.equivalenceClass?.slug ?? null,
    };
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }

  // ── rank ─────────────────────────────────────────────────────────────────────────────────
  type Scored = {
    key: string; headNoun: string; bucket: string; members: Member[];
    merchants: string[]; alreadyClassed: number; score: number;
    unitLo: number | null; unitHi: number | null; spread: number | null;
    brandKeyed: boolean;
  };
  const scored: Scored[] = [];
  for (const [key, members] of groups) {
    if (members.length < 2) continue;
    const merchants = [...new Set(members.flatMap((m) => m.merchants))];
    if (merchants.length < MIN_MERCHANTS) continue;

    const alreadyClassed = members.filter((m) => m.classSlug).length;
    // A group already mostly covered is not an opportunity. Partial overlap IS reported —
    // a class catching a minority of its own group has a window that is too tight.
    if (alreadyClassed > members.length / 2) continue;

    const ups = members.map((m) => m.unitPriceBani).filter((x): x is number => x != null && x > 0);
    const unitLo = ups.length ? Math.min(...ups) : null;
    const unitHi = ups.length ? Math.max(...ups) : null;
    const [hn, bucket] = key.split("|");
    scored.push({
      key, headNoun: hn, bucket, members, merchants, alreadyClassed,
      // The group key is a BRAND, not a noun — see the brand-set note above.
      brandKeyed: knownBrands.has(hn),
      // THE RANKING: a class pays only when it spans merchants.
      score: merchants.length * members.length,
      unitLo, unitHi,
      spread: unitLo && unitHi ? unitHi / unitLo : null,
    });
  }
  scored.sort((a, b) => b.score - a.score);

  // ── report ───────────────────────────────────────────────────────────────────────────────
  const shown = scored.slice(0, TOP);
  console.log("═".repeat(112));
  console.log("  PHASE 1a — WHERE WOULD THE NEXT EQUIVALENCE CLASSES PAY MOST?");
  console.log("═".repeat(112));
  console.log(`  live grocery products:            ${products.length}`);
  console.log(`  not bucketable (unit/size/noun):  ${unbucketed}`);
  console.log(`  candidate groups (2+ products, ${MIN_MERCHANTS}+ merchants, not already covered): ${scored.length}`);
  console.log(`  showing top ${shown.length}, ranked by (distinct merchants × products)`);
  console.log();
  console.log("  ── THIS IS A READING AID, NOT A PROPOSER. It writes nothing and decides nothing.");
  console.log("  Whether a group is a real equivalence is a judgement about what people buy, and");
  console.log("  CLAUDE.md is explicit that no query can supply it. Spread is shown so the");
  console.log("  suspicious ones surface first — it is NOT evidence that any member is wrong.");
  console.log("═".repeat(112));

  console.log(`\n  ${"#".padStart(3)}  ${"head noun".padEnd(22)}${"size".padEnd(8)}${"prod".padStart(5)}${"shops".padStart(6)}${"score".padStart(7)}  ${"unit-price range".padEnd(22)}spread`);
  console.log("  " + "─".repeat(104));
  shown.forEach((g, i) => {
    const range = g.unitLo && g.unitHi ? `${bani(g.unitLo)}–${bani(g.unitHi)}/${g.members[0].unit}` : "—";
    const sp = g.spread ? `${g.spread.toFixed(1)}x${g.spread > 2 ? "  ⚠" : ""}` : "—";
    console.log(
      `  ${String(i + 1).padStart(3)}  ${g.headNoun.slice(0, 21).padEnd(22)}${g.bucket.padEnd(8)}${String(g.members.length).padStart(5)}${String(g.merchants.length).padStart(6)}${String(g.score).padStart(7)}  ${range.padEnd(22)}${sp}`,
    );
  });

  // ── THE SECOND TABLE, AND IT IS THE USEFUL ONE ──────────────────────────────────────────
  //
  // Ranking by (merchants × products) does what the brief asked and surfaces the LEAST usable
  // groups first, because the most generic head nouns are the most numerous. "bautura 0.5l" is a
  // category, not a need a shopper substitutes within. The tell is mechanical: a generic noun
  // spans many size buckets AND carries a huge unit-price spread.
  //
  // So genericity is measured rather than eyeballed, and a second ranking is printed over groups
  // that look like real like-for-like sets. Both are shown; neither is hidden.
  const bucketsPerNoun = new Map<string, number>();
  for (const g of scored) bucketsPerNoun.set(g.headNoun, (bucketsPerNoun.get(g.headNoun) ?? 0) + 1);

  const tight = scored
    .filter((g) => !g.brandKeyed && g.spread != null && g.spread < 2 && (bucketsPerNoun.get(g.headNoun) ?? 1) <= 3)
    .slice(0, 60);
  const brandKeyed = scored.filter((g) => g.brandKeyed);

  console.log(`\n\n${"═".repeat(112)}`);
  console.log("  THE SAME CANDIDATES, FILTERED TO WHAT COULD PLAUSIBLY BE A CLASS");
  console.log("═".repeat(112));
  console.log("  Two filters, both mechanical:");
  console.log("    · unit-price spread < 2x  — CLAUDE.md's own flag bar. A wide spread inside one");
  console.log("      head noun means the group holds different PRODUCTS, not different brands.");
  console.log("    · head noun spans <= 3 size buckets — a noun appearing at every size is a");
  console.log("      category word ('bautura', 'set', 'sos'), not a need.");
  console.log("    · the head noun is not itself a BRAND. 39.6% of live grocery products carry no");
  console.log(`      brand field, so headNoun returns the brand for them: ${brandKeyed.length} of`);
  console.log(`      ${scored.length} groups are keyed by a brand and are product FAMILIES, not classes.`);
  console.log(`  ${tight.length} of ${scored.length} candidate groups survive both.`);
  console.log();
  console.log(`  ${"#".padStart(3)}  ${"head noun".padEnd(22)}${"size".padEnd(8)}${"prod".padStart(5)}${"shops".padStart(6)}${"score".padStart(7)}  ${"unit-price range".padEnd(22)}spread`);
  console.log("  " + "─".repeat(104));
  tight.forEach((g, i) => {
    const range = g.unitLo && g.unitHi ? `${bani(g.unitLo)}–${bani(g.unitHi)}/${g.members[0].unit}` : "—";
    console.log(
      `  ${String(i + 1).padStart(3)}  ${g.headNoun.slice(0, 21).padEnd(22)}${g.bucket.padEnd(8)}${String(g.members.length).padStart(5)}${String(g.merchants.length).padStart(6)}${String(g.score).padStart(7)}  ${range.padEnd(22)}${g.spread!.toFixed(2)}x`,
    );
  });
  console.log(`\n  Neither filter is a verdict. A 1.4x spread can still be two different products,`);
  console.log(`  and a 3x spread can be one product with a luxury brand in it. They sort the`);
  console.log(`  reading queue; they do not decide membership.`);

  console.log(`\n\n${"═".repeat(112)}`);
  console.log("  THE TIGHT CANDIDATES, IN FULL — members, shops, own sizes and unit prices.");
  console.log("═".repeat(112));
  for (const [i, g] of tight.entries()) {
    console.log(`\n[T${i + 1}] ${g.headNoun}  ·  ${g.bucket}  ·  ${g.members.length} products across ${g.merchants.length} shops  ·  spread ${g.spread!.toFixed(2)}x`);
    console.log(`    shops: ${g.merchants.join(", ")}`);
    for (const m of g.members) {
      const up = m.unitPriceBani ? `${bani(m.unitPriceBani)}/${m.unit}` : "—";
      console.log(
        `      ${m.name.slice(0, 60).padEnd(61)}${String(m.unitSize ?? "").padStart(6)}${(m.unit ?? "").padEnd(4)}${bani(m.priceBani).padStart(8)}  ${up.padEnd(13)}${m.merchants.join("+")}${m.classSlug ? `  [${m.classSlug}]` : ""}`,
      );
    }
  }

  console.log(`\n\n${"═".repeat(112)}`);
  console.log("  THE SAME GROUPS, IN FULL — members, shops, own sizes and unit prices.");
  console.log("  Read these. The table above only says where to look.");
  console.log("═".repeat(112));
  for (const [i, g] of shown.entries()) {
    console.log(`\n[${i + 1}] ${g.headNoun}  ·  ${g.bucket}  ·  ${g.members.length} products across ${g.merchants.length} shops  ·  score ${g.score}`);
    console.log(`    shops: ${g.merchants.join(", ")}`);
    if (g.alreadyClassed) {
      console.log(`    ⚠ ${g.alreadyClassed}/${g.members.length} already in a class (${[...new Set(g.members.map((m) => m.classSlug).filter(Boolean))].join(", ")}) — an existing window may be too tight`);
    }
    if (g.brandKeyed) {
      console.log(`    ⚠ THE KEY IS A BRAND, not a noun — this is a product family. The members carry no`);
      console.log(`      brand field, so headNoun fell back to the leading token. Not a class candidate.`);
    }
    if (g.spread && g.spread > 2) {
      console.log(`    ⚠ unit-price spread ${g.spread.toFixed(1)}x — READ THE MEMBERS. This flags the GROUP, never a member.`);
    }
    for (const m of g.members.slice(0, 14)) {
      const up = m.unitPriceBani ? `${bani(m.unitPriceBani)}/${m.unit}` : "—";
      console.log(
        `      ${m.name.slice(0, 52).padEnd(53)}${String(m.unitSize ?? "").padStart(6)}${(m.unit ?? "").padEnd(4)}${bani(m.priceBani).padStart(8)}  ${up.padEnd(13)}${m.merchants.join("+")}${m.classSlug ? `  [${m.classSlug}]` : ""}`,
      );
    }
    if (g.members.length > 14) console.log(`      … and ${g.members.length - 14} more`);
  }

  // What the whole opportunity is worth, as an upper bound with the reason it is one.
  const reachable = scored.reduce((a, g) => a + g.members.length, 0);
  const top40 = scored.slice(0, 40).reduce((a, g) => a + g.members.length, 0);
  const top200 = shown.reduce((a, g) => a + g.members.length, 0);
  console.log(`\n${"═".repeat(112)}`);
  console.log("  THE SIZE OF THE OPPORTUNITY — AN UPPER BOUND, AND HERE IS WHY.");
  console.log("═".repeat(112));
  console.log(`  products in ALL ${scored.length} candidate groups:   ${reachable}`);
  console.log(`  products in the top 40 groups:        ${top40}`);
  console.log(`  products in the top ${shown.length} groups:       ${top200}`);
  console.log();
  console.log(`  These are CEILINGS, not forecasts. Every real class rejects members the grouping`);
  console.log(`  accepts — different fat content, UHT vs fresh, BIO vs conventional, făină 000 vs`);
  console.log(`  650 — and the brief forbids merging any of those. The historical rate at which a`);
  console.log(`  candidate group survives contact with require/exclude rules is what batch 1 of`);
  console.log(`  Phase 1b exists to measure. Do not project from this number alone.`);
  console.log("═".repeat(112));

  emitJson({
    pass: true, liveGrocery: products.length, unbucketed,
    candidateGroups: scored.length, brandKeyedGroups: brandKeyed.length, reachableCeiling: reachable, top40Ceiling: top40,
    plausible: tight.map((g) => ({ headNoun: g.headNoun, bucket: g.bucket, products: g.members.length, merchants: g.merchants, score: g.score, spread: g.spread })),
    groups: shown.map((g) => ({
      headNoun: g.headNoun, bucket: g.bucket, products: g.members.length,
      merchants: g.merchants, score: g.score, spread: g.spread,
      alreadyClassed: g.alreadyClassed,
      members: g.members.map((m) => ({ id: m.id, name: m.name, unit: m.unit, unitSize: m.unitSize, merchants: m.merchants, priceBani: m.priceBani, classSlug: m.classSlug })),
    })),
  });
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
