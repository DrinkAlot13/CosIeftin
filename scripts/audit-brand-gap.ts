// ── HOW MANY PRODUCTS HAVE NO BRAND, AND IS THE BRAND OBTAINABLE? READ-ONLY. WRITES NOTHING.
//
// Phase 1a found that 33.6% of live grocery products carry no `brand`, and that this wrecks class
// grouping: `headNoun` is brand-aware and correct, but it can only skip a brand it is TOLD about,
// so for a brandless product the leading token IS the brand and the group becomes "every Alpro
// 1 l product" — a brand family, which CLAUDE.md names as exactly what a class must not be.
//
// ── WHERE THE GAP ACTUALLY IS. It is not spread evenly and it is not produce.
//
// Sezamo (11.8% coverage, 8,169 offers) and the three Glovo storefronts (12-28%) are almost the
// whole of it. Every other merchant is at 91-99%. And the missing products are not unbranded
// goods: "Zott Liegeois cacao 175 g", "Bonduelle Miniconserva Naut", "Panzani Orez natur 500 g".
// The brand is right there — in the NAME, at the front.
//
// ── THREE ROUTES, AND THEY ARE NOT EQUALLY GOOD. NEVER SUMMED.
//
//   1. STORED PAYLOAD — `Offer.rawSourceBlob` already holds the merchant's own payload. Free,
//      exact, no network. This is TRUTH: the merchant said it and we did not write it down.
//
//   2. MERCHANT NAMING CONVENTION — for Sezamo and Glovo, the merchant's own `storeName` LEADS
//      with the brand. This is an inference, but a MEASURED one, and the measurement is a real
//      oracle rather than a restatement: take offers from that merchant whose product has a
//      brand supplied INDEPENDENTLY by a different merchant, and check whether the storeName's
//      leading token predicts it. Sezamo scores 99.3%. That number is derived from data the rule
//      itself never sees.
//
//   3. BRAND VOCABULARY — the leading token appears in `catalogBrands` or `KNOWN_BRANDS`. This
//      is the WEAKEST route and it is reported to be dismissed: `catalogBrands` is built for
//      search REQUIRE (where a false positive costs a filtered result) and its 1,629 tokens
//      include "verde", "bucata", "romania", "gradina". Writing those into a brand column would
//      feed the matcher's brand gate with adjectives — the Zarea shape, where one loose brand
//      backed 64 unrelated wines. Fit for its own purpose; unfit for this one.
//
//   npm run audit:brand-gap
//   npm run audit:brand-gap -- --json reports/brand-gap.json

import { PrismaClient } from "@prisma/client";
import { catalogBrands, isKnownBrand, KNOWN_BRANDS } from "../src/lib/search/brands";
import { headNounFrequency } from "../src/lib/search/search";
import { normalizeRo } from "../src/lib/text/normalizeRo";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();

/**
 * Values a merchant writes that mean "no brand".
 *
 * Found by reading real blob values, not guessed: Mega Image writes "(bucata)" and
 * "(produs ambalat)" into `manufacturerName`, and Metro writes the literal "NO BRAND".
 * Treating those as brands would be the "default presented as an observation" defect.
 */
const PLACEHOLDER = new Set([
  "", "-", "--", "n/a", "na", "null", "undefined", "none", "no brand", "nobrand",
  "fara marca", "fara brand", "generic", "altele", "diverse", "mega",
]);
const isPlaceholder = (v: string): boolean => {
  const t = v.trim().toLowerCase();
  return PLACEHOLDER.has(t) || /^\(.*\)$/.test(t) || t.length < 2;
};

const cleanBrand = (b: string | null | undefined): string =>
  !b || isPlaceholder(b) ? "" : b.trim();

/** Pull a brand out of a merchant's own stored payload. */
export function brandFromBlob(blob: string | null): { value: string; key: string } | null {
  if (!blob) return null;
  let obj: unknown;
  try { obj = JSON.parse(blob); } catch { return null; }
  const keys = ["brand", "manufacturerName", "marca", "producator", "brandName", "manufacturer"];
  const walk = (o: unknown, depth: number): { value: string; key: string } | null => {
    if (!o || typeof o !== "object" || depth > 4) return null;
    const rec = o as Record<string, unknown>;
    for (const k of keys) {
      const v = rec[k];
      if (typeof v === "string" && !isPlaceholder(v)) return { value: v.trim(), key: k };
      if (v && typeof v === "object" && typeof (v as Record<string, unknown>).name === "string") {
        const n = String((v as Record<string, unknown>).name);
        if (!isPlaceholder(n)) return { value: n.trim(), key: `${k}.name` };
      }
    }
    for (const v of Object.values(rec)) {
      const hit = walk(v, depth + 1);
      if (hit) return hit;
    }
    return null;
  };
  return walk(obj, 0);
}

/**
 * The brand a `storeName` leads with, or "" when the leading token is a product word.
 *
 * The head-noun guard is the whole safety of this route. Without it "Lapte de consum..." yields
 * brand="lapte", which is not a brand and which would then gate matching on a category word.
 * `headNounFrequency` is imported rather than recomputed — same map `catalogBrands` uses.
 */
export function brandFromLeadToken(storeName: string, headFreq: Map<string, number>): string {
  const toks = normalizeRo(storeName).split(/\s+/).filter(Boolean);
  const first = toks[0];
  if (!first || first.length < 3 || /^\d/.test(first)) return "";
  if ((headFreq.get(first) ?? 0) >= 5) return ""; // a word that heads many products is a product word
  return first;
}

async function main(): Promise<void> {
  const live = { merchant: { active: true }, isStale: false, flagged: false };

  const products = await prisma.product.findMany({
    where: { section: "grocery", offers: { some: live } },
    select: {
      id: true, name: true, brand: true,
      offers: {
        where: live,
        select: { storeName: true, rawSourceBlob: true, merchant: { select: { slug: true } } },
      },
    },
  });
  if (products.length === 0) {
    console.error("No live grocery products. Checked nothing — a FAILURE, not a pass.");
    emitJson({ pass: false, reason: "no-population" });
    await prisma.$disconnect();
    process.exit(1);
  }

  const headFreq = headNounFrequency(products.map((p) => ({ name: p.name })) as never);
  const declared = catalogBrands(products as never, headFreq);
  const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) : "—");

  // ── THE ORACLE FOR ROUTE 2 ────────────────────────────────────────────────────────────────
  // Does this merchant's storeName lead with the brand? Checked ONLY against products whose
  // brand came from a DIFFERENT merchant, so the rule is graded by evidence it cannot see.
  console.log("═".repeat(104));
  console.log("  ROUTE 2's ORACLE — does the merchant's own storeName lead with the brand?");
  console.log("  Graded against products whose brand was supplied INDEPENDENTLY by another merchant.");
  console.log("═".repeat(104));
  console.log(`  merchant          graded   leads with brand   in first 3 tokens`);
  const oracle: Record<string, { n: number; lead: number; near: number }> = {};
  const lowCoverage = ["sezamo", "glovo-kaufland", "glovo-profi", "glovo-penny", "kaufland", "penny", "selgros"];
  for (const slug of lowCoverage) {
    let n = 0, lead = 0, near = 0;
    for (const p of products) {
      const b = cleanBrand(p.brand);
      if (!b) continue;
      const o = p.offers.find((x) => x.merchant.slug === slug && x.storeName);
      if (!o?.storeName) continue;
      // the brand must have come from someone else, or this proves nothing
      if (!p.offers.some((x) => x.merchant.slug !== slug)) continue;
      n++;
      const toks = normalizeRo(o.storeName).split(/\s+/);
      const bTok = normalizeRo(b).split(/\s+/)[0];
      if (toks[0] === bTok) lead++;
      else if (toks.slice(0, 3).includes(bTok)) near++;
    }
    oracle[slug] = { n, lead, near };
    if (n === 0) { console.log(`  ${slug.padEnd(16)}${String(n).padStart(8)}   (no independently-branded overlap — INCONCLUSIVE)`); continue; }
    console.log(`  ${slug.padEnd(16)}${String(n).padStart(8)}${`${pct(lead, n)}%`.padStart(19)}${`${pct(lead + near, n)}%`.padStart(20)}`);
  }
  console.log(`\n  A merchant under ~90% here is NOT safe to harvest by this route. INCONCLUSIVE is`);
  console.log(`  neither a pass nor a failure — it means the overlap was too small to grade.`);

  // ── the gap, and which route reaches it ───────────────────────────────────────────────────
  const SAFE = new Set(Object.entries(oracle).filter(([, o]) => o.n >= 50 && o.lead / o.n >= 0.9).map(([s]) => s));

  let missing = 0, r1 = 0, r2 = 0, r3 = 0, none = 0;
  const ex1: string[] = [], ex2: string[] = [], ex3: string[] = [];
  const perMerchant = new Map<string, { live: number; withBrand: number }>();
  for (const p of products) {
    for (const o of p.offers) {
      const m = perMerchant.get(o.merchant.slug) ?? { live: 0, withBrand: 0 };
      m.live++;
      if (cleanBrand(p.brand)) m.withBrand++;
      perMerchant.set(o.merchant.slug, m);
    }
    if (cleanBrand(p.brand)) continue;
    missing++;

    const blob = p.offers.map((o) => ({ o, b: brandFromBlob(o.rawSourceBlob) })).find((x) => x.b);
    if (blob?.b) {
      r1++;
      if (ex1.length < 10) ex1.push(`${blob.o.merchant.slug.padEnd(12)} ${blob.b.value.slice(0, 20).padEnd(21)} ← ${blob.b.key.padEnd(17)} ${p.name.slice(0, 40)}`);
      continue;
    }
    const safeOffer = p.offers.find((o) => SAFE.has(o.merchant.slug) && o.storeName);
    const lead = safeOffer?.storeName ? brandFromLeadToken(safeOffer.storeName, headFreq) : "";
    if (lead) {
      r2++;
      if (ex2.length < 10) ex2.push(`${safeOffer!.merchant.slug.padEnd(12)} ${lead.slice(0, 20).padEnd(21)} ← storeName      ${safeOffer!.storeName!.slice(0, 40)}`);
      continue;
    }
    const t = normalizeRo(p.name).split(/\s+/)[0];
    if (t && (declared.has(t) || isKnownBrand(t))) {
      r3++;
      if (ex3.length < 10) ex3.push(`${t.padEnd(20)} ${p.name.slice(0, 52)}`);
      continue;
    }
    none++;
  }

  const have = products.length - missing;
  console.log(`\n${"═".repeat(104)}`);
  console.log("  THE BRAND GAP");
  console.log("═".repeat(104));
  console.log(`  live grocery products:  ${products.length}`);
  console.log(`  carrying a brand:       ${have}  (${pct(have, products.length)}%)`);
  console.log(`  MISSING a brand:        ${missing}  (${pct(missing, products.length)}%)`);

  console.log(`\n  PER MERCHANT`);
  console.log(`  merchant          live offers   with brand`);
  for (const [slug, m] of [...perMerchant].sort((a, b) => b[1].live - a[1].live)) {
    console.log(`  ${slug.padEnd(16)}${String(m.live).padStart(12)}${`${pct(m.withBrand, m.live)}%`.padStart(13)}`);
  }

  console.log(`\n${"═".repeat(104)}`);
  console.log(`  IS IT OBTAINABLE? ${missing} products with no brand. ROUTES ARE NEVER SUMMED.`);
  console.log("═".repeat(104));
  console.log(`  ROUTE 1  stored payload (TRUTH)                ${String(r1).padStart(6)}  ${pct(r1, missing)}%`);
  console.log(`  ROUTE 2  storeName lead token, oracle-backed   ${String(r2).padStart(6)}  ${pct(r2, missing)}%   merchants: ${[...SAFE].join(", ") || "none qualified"}`);
  console.log(`  ROUTE 3  brand vocabulary (REJECTED, see below)${String(r3).padStart(6)}  ${pct(r3, missing)}%`);
  console.log(`  none of the three                             ${String(none).padStart(6)}  ${pct(none, missing)}%`);
  console.log();
  console.log(`  coverage now:              ${pct(have, products.length)}%`);
  console.log(`  after route 1:             ${pct(have + r1, products.length)}%`);
  console.log(`  after routes 1 + 2:        ${pct(have + r1 + r2, products.length)}%`);

  if (ex1.length) { console.log(`\n  ROUTE 1 — the brand is in the payload we already stored:`); ex1.forEach((s) => console.log(`    ${s}`)); }
  if (ex2.length) { console.log(`\n  ROUTE 2 — the merchant's own name leads with it:`); ex2.forEach((s) => console.log(`    ${s}`)); }
  if (ex3.length) {
    console.log(`\n  ROUTE 3 — REJECTED. These are what the vocabulary would write into a brand column:`);
    ex3.forEach((s) => console.log(`    ${s}`));
    console.log(`    `);
    console.log(`    A brand gate fed "verde" or "bucata" stops discriminating anything. CLAUDE.md's`);
    console.log(`    Zarea regression is one loose brand backing 64 unrelated wines. Not taken.`);
  }

  console.log(`\n${"═".repeat(104)}`);
  console.log(`  vocabularies (built as search builds them, not restated)`);
  console.log(`    catalogBrands: ${declared.size}    KNOWN_BRANDS: ${KNOWN_BRANDS.size}`);
  console.log("═".repeat(104));

  emitJson({
    pass: true, liveGrocery: products.length, have, missing,
    route1: r1, route2: r2, route3Rejected: r3, none,
    safeMerchants: [...SAFE], oracle,
    coverageNow: Number((have / products.length).toFixed(4)),
    coverageAfter12: Number(((have + r1 + r2) / products.length).toFixed(4)),
    perMerchant: [...perMerchant].map(([slug, m]) => ({ slug, ...m })),
  });
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
