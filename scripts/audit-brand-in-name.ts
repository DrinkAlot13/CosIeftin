// ── SCOPE: MERCHANT NAMING CONVENTIONS ────────────────────────────────────────
// DOES THIS MERCHANT PUT THE BRAND IN ITS PRODUCT NAMES? READ-ONLY.
//
// Nearly every recoverable match from the descriptor work was Freshful, and the reason turned
// out to be one merchant's house style rather than anything about language: Freshful writes
// "Salam de Sibiu, feliat 120g" where the catalog holds "Salam de Sibiu Agricola, 120 g". The
// catalog side carries a BRAND token the store side lacks, the store side carries a descriptor
// the catalog lacks, and `mutually-distinct` fires on what is really a house style.
//
// That is a PER-MERCHANT property, so it is measurable per merchant — and if a second merchant
// has the same shape, the same lost matches are sitting there unmeasured.
//
// THE MEASURE. For every live offer whose matched catalog product has a brand, does the
// merchant's OWN name for it contain that brand? A merchant at 95% names its brands; one at 20%
// does not, and its matches will keep failing on brand asymmetry.
//
// WHAT THIS IS NOT. It does not say a low score is wrong. Freshful's names are perfectly good
// names — a shopper browsing Freshful already knows whose salami it is. It is a fact about how
// the two vocabularies meet, not a criticism of either.
//
//   npm run audit:brand-in-name

import { PrismaClient } from "@prisma/client";
import { normalizeRo } from "../src/lib/text/normalizeRo";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();

/** Brand words too generic to look for — a hit would prove nothing. */
const SKIP = new Set(["bio", "eco", "the", "de", "la", "no", "nr", "and", "for"]);

async function main(): Promise<void> {
  const cutoff = new Date(Date.now() - 14 * 86_400_000);
  const offers = await prisma.offer.findMany({
    where: {
      merchant: { active: true }, availability: "in stock", isStale: false, flagged: false,
      lastObservedAt: { gte: cutoff },
      storeName: { not: null },
      product: { brand: { not: null } },
    },
    select: {
      storeName: true,
      merchant: { select: { slug: true } },
      product: { select: { name: true, brand: true } },
    },
  });

  // NOTE: `Offer` has no storeBrand column — that lives on PendingMatch. So this measures
  // exactly one thing: is the brand in the NAME the merchant publishes? Which is the question.
  type Row = { checked: number; inName: number; inBrandField: number; missing: number; examples: string[] };
  const per = new Map<string, Row>();

  for (const o of offers) {
    const brandTokens = normalizeRo(o.product.brand ?? "")
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !SKIP.has(t));
    if (brandTokens.length === 0) continue;

    const e = per.get(o.merchant.slug) ?? { checked: 0, inName: 0, inBrandField: 0, missing: 0, examples: [] };
    e.checked++;

    const storeName = normalizeRo(o.storeName ?? "");
    // Any brand token present is enough: "Laptaria cu caimac" need not appear whole.
    const inName = brandTokens.some((t) => storeName.includes(t));

    if (inName) e.inName++;
    else {
      e.missing++;
      if (e.examples.length < 4) {
        e.examples.push(`${JSON.stringify((o.storeName ?? "").slice(0, 44))}  ↔  ${o.product.name.slice(0, 46)} [${o.product.brand}]`);
      }
    }
    per.set(o.merchant.slug, e);
  }

  console.log("═".repeat(104));
  console.log("DOES THE MERCHANT PUT THE BRAND IN ITS PRODUCT NAMES?");
  console.log("Live offers whose matched catalog product has a brand.");
  console.log("═".repeat(104));
  console.log(`  ${"merchant".padEnd(16)} ${"checked".padStart(8)} ${"in name".padStart(9)} ${"NEITHER".padStart(9)} ${"names it".padStart(9)}`);

  const rows = [...per.entries()].sort((a, b) => (a[1].inName / a[1].checked) - (b[1].inName / b[1].checked));
  for (const [slug, e] of rows) {
    const pct = (e.inName / Math.max(1, e.checked)) * 100;
    console.log(`  ${slug.padEnd(16)} ${String(e.checked).padStart(8)} ${String(e.inName).padStart(9)} ${String(e.missing).padStart(9)} ${pct.toFixed(1).padStart(8)}%`);
  }

  console.log(`\n── MERCHANTS THAT OFTEN OMIT THE BRAND, with examples ──`);
  for (const [slug, e] of rows) {
    const pct = (e.inName / Math.max(1, e.checked)) * 100;
    if (pct >= 80 || e.examples.length === 0) continue;
    console.log(`\n  ${slug} — names the brand in ${pct.toFixed(1)}% of ${e.checked} offers`);
    for (const x of e.examples) console.log(`      ${x}`);
  }

  const worst = rows[0];
  const others = rows.filter(([, e]) => e.checked >= 200 && e.inName / e.checked < 0.8);
  console.log(`\n${"─".repeat(104)}`);
  console.log(`IS THIS ONE MERCHANT, OR A CLASS?`);
  console.log("─".repeat(104));
  if (others.length <= 1) {
    console.log(`  ONE MERCHANT. Only ${worst[0]} falls below 80%, so a fix aimed at this is`);
    console.log(`  merchant-specific and should be named as such rather than dressed up as a`);
    console.log(`  general rule.`);
  } else {
    console.log(`  ${others.length} MERCHANTS fall below 80% with 200+ offers checked:`);
    for (const [s, e] of others) console.log(`    ${s.padEnd(16)} ${((e.inName / e.checked) * 100).toFixed(1)}% of ${e.checked}`);
    console.log(`  The same lost matches may be sitting unmeasured at each of them.`);
  }

  emitJson({
    merchants: rows.map(([slug, e]) => ({
      merchant: slug, checked: e.checked, inName: e.inName, inBrandField: e.inBrandField,
      neither: e.missing, share: Number((e.inName / Math.max(1, e.checked)).toFixed(4)),
    })),
    pass: true,
  });
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
