// ── NUMERIC VARIANT CODES: A DISCRIMINATOR THE MATCHER STRUCTURALLY CANNOT SEE. READ-ONLY.
//
// L'Oreal hair-dye shade "613", Metro shrimp count "30/40" — found while investigating the
// flyer fan-out catalog-wide diff (docs/SOAK.md, 2026-09-16). `overlapTokens()` drops every bare
// numeric token as size noise (`SIZE_TOKEN` in scrape-util.ts matches a number WITH OR WITHOUT a
// unit suffix), on the assumption that a bare number restates the already-parsed size. That
// assumption is usually right and occasionally very wrong: when the bare number is a shade, a
// count-per-kilo grade, or an age statement, it is the ONE thing that tells two products apart,
// and the matcher throws it away before mutual distinction ever runs — the exact same shape as
// `doseTokens()`'s regression (CLAUDE.md): a real discriminator the matcher cannot see is
// indistinguishable, from the outside, from one that agrees.
//
// ── THIS DOES NOT TOUCH SIZE_TOKEN OR overlapTokens. It reuses `overlapTokens` (the canonical,
// exported function) to find what it ALREADY drops, by diffing the raw token list against its
// output — the same notion of "stripped" the matcher itself uses, not a second regex.
//
// ── TWO QUESTIONS, MEASURED SEPARATELY.
//
//   1. HOW MANY PRODUCTS CARRY ONE. A bare 2-4 digit token, stripped by overlapTokens, that does
//      not plausibly restate the product's own parsed size in any common unit scaling. 1-digit
//      tokens are excluded (almost always a count word — "2 in 1" — not a code); 5+ digit tokens
//      are excluded (EAN-shaped, a different thing entirely).
//   2. HOW MANY CURRENT MATCHES THIS IS ALREADY CORRUPTING. Reuses the exact (merchant,
//      storeName) grouping `audit:flyer-fanout` uses — the same detector, not a new one — but
//      narrows it to groups whose member products are IDENTICAL once their numeric codes are
//      stripped out. That isolates this SPECIFIC blindness from the catalog-duplicate confound
//      the flyer-fanout diff could not separate out, and it is not scoped to physical merchants:
//      the flyer rule only vetoes Kaufland/Penny, so this counts what is happening RIGHT NOW on
//      every other merchant too — Auchan's L'Oreal shades among them.
//
// Do not fix here. This touches the size regex, which is load-bearing across every merchant's
// matching — CLAUDE.md's own rule: measure the blast radius before changing it.
//
//   npm run audit:numeric-variant-codes

import { PrismaClient } from "@prisma/client";
import { overlapTokens } from "../src/lib/scrape-util";
import { normalizeText } from "../src/lib/matching";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();

/**
 * A stripped bare numeric token that does not plausibly restate the product's own size, AND is
 * not already compared explicitly by `doseTokens()` under a different name. `doseTokens()` reads
 * mg/UI/mcg strengths and `N%` (fat, alcohol, concentration) off the RAW name before punctuation
 * is stripped — so "20% grasime" becomes a bare "20" once normalizeText drops the `%`, but the
 * matcher never loses that discriminator; it sees it via doseTokens instead. Counting it here
 * would overstate the population this project is actually blind to.
 */
function candidateCodes(name: string, unit: string, unitSize: number): string[] {
  const norm = normalizeText(name);
  const raw = norm.split(/\s+/).filter(Boolean);
  const kept = new Set(overlapTokens(norm));
  const stripped = raw.filter((t) => !kept.has(t) && /^\d{2,4}$/.test(t));
  if (stripped.length === 0) return [];

  // Does this bare number plausibly restate the parsed size, in ANY common scaling? kg->g
  // (x1000), l->ml (x1000), l->cl (x100), or the size itself rounded. A candidate that matches
  // NONE of these is not a restatement of the size the product already carries.
  const plausibleSizeNumbers = new Set(
    [unitSize, unitSize * 1000, unitSize * 100, Math.round(unitSize), Math.round(unitSize * 1000), Math.round(unitSize * 100)]
      .map((n) => String(Math.round(n))),
  );
  // Numbers doseTokens already extracts from the raw (pre-strip) name: N% and N mg/ui/iu/mcg.
  const doseCovered = new Set<string>();
  for (const m of name.matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)) doseCovered.add(String(Math.round(parseFloat(m[1].replace(",", ".")))));
  for (const m of name.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:mg|ui|iu|mcg)\b/gi)) doseCovered.add(String(Math.round(parseFloat(m[1].replace(",", ".")))));

  return stripped.filter((t) => !plausibleSizeNumbers.has(String(Number(t))) && !doseCovered.has(String(Number(t))));
}

/** Normalized name with every candidate code removed — what two names look like to the matcher. */
function withoutCodes(name: string, codes: string[]): string {
  const norm = normalizeText(name);
  const codeSet = new Set(codes);
  return norm.split(/\s+/).filter((t) => !codeSet.has(t)).join(" ");
}

async function main(): Promise<void> {
  const live = { merchant: { active: true }, isStale: false, flagged: false };

  // ── QUESTION 1: HOW MANY PRODUCTS CARRY ONE, PER SECTION ────────────────────────────────
  const products = await prisma.product.findMany({
    where: { offers: { some: live } },
    select: { id: true, name: true, unit: true, unitSize: true, section: true },
  });

  const withCode = new Map<number, string[]>();
  for (const p of products) {
    const codes = candidateCodes(p.name, p.unit, p.unitSize);
    if (codes.length) withCode.set(p.id, codes);
  }

  console.log("═".repeat(104));
  console.log("  NUMERIC VARIANT CODES — a discriminator overlapTokens() strips as size noise");
  console.log("═".repeat(104));
  console.log(`  live products scanned: ${products.length}`);
  console.log(`  carry a stripped bare numeric code not matching their own size: ${withCode.size}`);

  const bySection = new Map<string, number>();
  for (const p of products) if (withCode.has(p.id)) bySection.set(p.section, (bySection.get(p.section) ?? 0) + 1);
  console.log(`\n  BY SECTION`);
  for (const [sec, n] of [...bySection.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${sec.padEnd(12)} ${n}`);

  console.log(`\n  SAMPLE (20 of ${withCode.size})`);
  let shown = 0;
  for (const [id, codes] of withCode) {
    if (shown >= 20) break;
    const p = products.find((x) => x.id === id)!;
    console.log(`    #${id}  code(s)=${codes.join(",")}  "${p.name.slice(0, 64)}"`);
    shown++;
  }

  // ── QUESTION 2: HOW MANY CURRENT MATCHES THIS IS ALREADY CORRUPTING ─────────────────────
  //
  // Reuse of the SAME (merchant, storeName) grouping `audit:flyer-fanout` uses — every offer,
  // every merchant (not scoped to physical), because the flyer rule only vetoes Kaufland/Penny.
  const offers = await prisma.offer.findMany({
    where: { isStale: false, flagged: false, storeName: { not: null } },
    select: {
      storeName: true, priceBani: true, price: true,
      merchant: { select: { id: true, slug: true, name: true } },
      product: { select: { id: true, name: true, unit: true, unitSize: true } },
    },
  });
  const byStoreItem = new Map<string, typeof offers>();
  for (const o of offers) {
    const key = `${o.merchant.id}::${o.storeName}`;
    byStoreItem.set(key, [...(byStoreItem.get(key) ?? []), o]);
  }
  const fanoutGroups = [...byStoreItem.values()].filter((g) => new Set(g.map((o) => o.product.id)).size > 1);

  // Of those, which are EXPLAINED by this specific blindness: strip each member's candidate
  // codes and cluster by what's left. Clustering, not requiring the WHOLE group to collapse to
  // one name, matters in practice — the Auchan L'Oreal group below has 6 members, and one of
  // them ("...semi-permanenta...Choco Mocha, 418...") carries a genuine extra word on top of its
  // code. Requiring unanimity across all 6 would hide that the OTHER five (500/613/603/400/300)
  // differ from each other by nothing but the shade number, which is the exact blindness this
  // measures. This isolates numeric-code blindness from the catalog-duplicate confound
  // (byte-identical names with no code involved, Task 1's territory) and from any other cause.
  let explainedGroups = 0;
  let explainedOffers = 0;
  let physicalScoped = 0; // clusters already covered by the flyer-fanout veto — not newly blocked by a fix
  let physicalScopedOffers = 0;
  const samples: { merchant: string; storeName: string; price: string; scoped: boolean; products: { id: number; name: string; code: string }[] }[] = [];

  const physicalMerchants = new Set((await prisma.merchant.findMany({ where: { storeType: "physical" }, select: { slug: true } })).map((m) => m.slug));

  for (const g of fanoutGroups) {
    const uniqueProducts = new Map(g.map((o) => [o.product.id, o.product]));
    const withCodes = [...uniqueProducts.values()]
      .map((p) => {
        const codes = candidateCodes(p.name, p.unit, p.unitSize);
        return { p, codes, raw: normalizeText(p.name), stripped: withoutCodes(p.name, codes) };
      })
      .filter((x) => x.codes.length > 0); // only a member carrying a code can be explained by this cause

    const byStripped = new Map<string, typeof withCodes>();
    for (const x of withCodes) byStripped.set(x.stripped, [...(byStripped.get(x.stripped) ?? []), x]);

    for (const cluster of byStripped.values()) {
      const distinctRaw = new Set(cluster.map((x) => x.raw));
      if (distinctRaw.size < 2) continue; // one product, or byte-identical raws (Task 1's duplicate rows) — not this

      const clusterProductIds = new Set(cluster.map((x) => x.p.id));
      const clusterOffers = g.filter((o) => clusterProductIds.has(o.product.id));

      explainedGroups++;
      explainedOffers += clusterOffers.length;
      const scoped = physicalMerchants.has(g[0].merchant.slug);
      if (scoped) { physicalScoped++; physicalScopedOffers += clusterOffers.length; }
      if (samples.length < 200) {
        samples.push({
          merchant: g[0].merchant.name, storeName: g[0].storeName!, scoped,
          price: clusterOffers[0].priceBani != null ? `${(clusterOffers[0].priceBani / 100).toFixed(2)} lei` : `${clusterOffers[0].price} lei`,
          products: cluster.map((x) => ({ id: x.p.id, name: x.p.name, code: x.codes.join(",") })),
        });
      }
    }
  }

  console.log(`\n${"─".repeat(100)}`);
  console.log(`  HOW MANY CURRENT MATCHES ARE ALREADY CORRUPTED BY THIS, RIGHT NOW`);
  console.log("─".repeat(100));
  console.log(`  (merchant, storeName) groups matching 2+ products at all: ${fanoutGroups.length}`);
  console.log(`  of those, clusters explained by numeric-code blindness specifically: ${explainedGroups}`);
  console.log(`  live offers sitting inside those clusters: ${explainedOffers}`);
  console.log(`  of the explained clusters, on a storeType="physical" merchant (already withheld by`);
  console.log(`  the flyer-fanout rule — NOT newly exposed by fixing this): ${physicalScoped} cluster(s), ${physicalScopedOffers} offer(s)`);
  console.log(`  NOT already withheld by anything — live and wrong today: ${explainedGroups - physicalScoped} cluster(s), ${explainedOffers - physicalScopedOffers} offer(s)`);

  console.log(`\n  ALL ${samples.length > 0 ? "(sample of " + explainedGroups + ")" : ""} EXPLAINED CLUSTERS`);
  for (const s of samples) {
    console.log(`\n  [${s.merchant}] "${s.storeName}" (${s.price})${s.scoped ? " [ALREADY WITHHELD — physical merchant]" : ""}`);
    for (const p of s.products) console.log(`      #${p.id}  code=${p.code}  "${p.name.slice(0, 60)}"`);
  }

  console.log(`\n  This is a lower bound: it only counts a cluster where 2+ products, EACH carrying a`);
  console.log(`  code, collapse to an identical name once their codes are removed. A product that`);
  console.log(`  fanned out for this reason AND carries one extra genuine word is not counted at all —`);
  console.log(`  a group differing by a code plus a real word elsewhere is a different discriminator.`);

  emitJson({
    pass: true,
    productsWithCode: withCode.size,
    bySection: Object.fromEntries(bySection),
    fanoutGroupsTotal: fanoutGroups.length,
    explainedByNumericCode: explainedGroups,
    explainedOffers,
    alreadyWithheldPhysical: physicalScoped,
    liveAndUncorrected: explainedGroups - physicalScoped,
    samples,
  });
  await prisma.$disconnect();
}

function g_offers(samples: { products: unknown[] }[]): number {
  return samples.reduce((a, s) => a + s.products.length, 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
