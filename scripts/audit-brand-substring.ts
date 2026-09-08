// ── SCOPE: A FALSE-MATCH GENERATOR IN THE BRAND GATE. READ-ONLY. ──────────────
// IS A BRAND BEING "FOUND" INSIDE A LONGER WORD?
//
// `decide()`'s brand gate is the strongest thing standing between a shopper and one product's
// price shown on another:
//
//     const brandHit = branded && (st.nbrand.includes(cat.nbrand) || st.nname.includes(cat.nbrand));
//     if (branded && !brandHit) return { ok: false, band: "REJECT", score: 0, reason: "brand" };
//
// Both tests are SUBSTRING containment on a normalised string, not token equality. So a short
// brand is satisfied by any longer word that happens to contain its letters.
//
// **`aro` is Metro's private label, and `aroma` contains it.** Demonstrated end to end, with a
// control:
//
//     catalog "aro Dropsuri Menta 75 g" [brand aro]
//       vs "Dropsuri de menta 75g"           REJECT   brand      <- correct
//       vs "Dropsuri cu aroma de menta 75g"  MATCH    1.00       <- the word "aroma" did that
//
//     catalog "aro Detergent de Vase Lamaie 500 ml" [brand aro]
//       vs "Fine Life Detergent de Vase cu Aroma de Lamaie 500 ml"  MATCH 0.87
//
// The last one publishes one private label's price on a different private label's product.
//
// Every other rule in the matcher compares TOKENS, and `difference()` goes out of its way to be
// fuzzy about them. The brand gate compares raw substrings, and nothing said so.
//
// ── WHAT THIS COUNTS. Live offers whose catalog product HAS a brand, where the brand is found
// in the merchant's own name ONLY as a substring and never as a whole word. Offers matched by
// EAN are excluded: an EAN is proof and the brand gate never ran.
//
// It reports and ranks. It changes nothing.
//
//   npm run audit:brand-substring
//   npm run audit:brand-substring -- --sample=40

import { PrismaClient } from "@prisma/client";
import { normalizeText } from "../src/lib/matching";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();
const MAX_AGE = 14 * 86_400_000;

async function main(): Promise<void> {
  const a = process.argv.find((x) => x.startsWith("--sample="));
  const SAMPLE = a ? Number(a.split("=")[1]) : 25;

  const cutoff = new Date(Date.now() - MAX_AGE);
  const offers = await prisma.offer.findMany({
    where: {
      merchant: { active: true }, availability: "in stock", isStale: false, flagged: false,
      lastObservedAt: { gte: cutoff }, storeName: { not: null },
      product: { brand: { not: null } },
    },
    select: {
      id: true, storeName: true, price: true, priceBani: true, matchedBy: true,
      merchant: { select: { slug: true } },
      product: { select: { id: true, name: true, brand: true, slug: true, ean: true } },
    },
  });

  type Hit = {
    offerId: number; merchant: string; storeName: string;
    product: string; brand: string; slug: string; carrier: string;
  };
  const hits: Hit[] = [];
  const byBrand = new Map<string, number>();
  const byMerchant = new Map<string, number>();
  let branded = 0, substringOnly = 0;

  for (const o of offers) {
    if (o.matchedBy === "ean") continue;
    const nbrand = normalizeText(o.product.brand ?? "");
    if (!nbrand) continue;
    branded++;
    const nname = normalizeText(o.storeName ?? "");
    if (!nname.includes(nbrand)) continue; // the gate did not pass this way at all

    // Whole-word presence: the brand phrase bounded by string edges or spaces.
    const padded = ` ${nname} `;
    const whole = padded.includes(` ${nbrand} `)
      || padded.startsWith(`${nbrand} `)
      || padded.endsWith(` ${nbrand}`);
    if (whole) continue;

    substringOnly++;
    // WHICH word swallowed the brand — the evidence a reader needs to judge it.
    const carrier = nname.split(/\s+/).find((w) => w.includes(nbrand) && w !== nbrand) ?? "(spans words)";
    hits.push({
      offerId: o.id, merchant: o.merchant.slug, storeName: o.storeName as string,
      product: o.product.name, brand: o.product.brand as string, slug: o.product.slug, carrier,
    });
    byBrand.set(o.product.brand as string, (byBrand.get(o.product.brand as string) ?? 0) + 1);
    byMerchant.set(o.merchant.slug, (byMerchant.get(o.merchant.slug) ?? 0) + 1);
  }

  console.log("═".repeat(102));
  console.log("BRAND GATE — is a brand being found INSIDE a longer word?");
  console.log("═".repeat(102));
  console.log(`  live offers on a branded product (not EAN-matched)   ${branded}`);
  console.log(`  brand present ONLY as a substring, never as a word    ${substringOnly}` +
    `  (${((substringOnly / Math.max(1, branded)) * 100).toFixed(2)}%)`);

  if (substringOnly === 0) {
    console.log(`\n  NONE LIVE TODAY. The defect is real — it is demonstrable in one call to decide()`);
    console.log(`  — but no offer currently on the site was admitted this way. That is a fact about`);
    console.log(`  today's catalog, not a property of the gate: it stays exploitable until fixed.`);
  } else {
    console.log(`\n  BY BRAND`);
    for (const [b, n] of [...byBrand.entries()].sort((x, y) => y[1] - x[1]).slice(0, 15)) {
      console.log(`    ${b.slice(0, 28).padEnd(28)} ${String(n).padStart(6)}`);
    }
    console.log(`\n  BY MERCHANT`);
    for (const [m, n] of [...byMerchant.entries()].sort((x, y) => y[1] - x[1])) {
      console.log(`    ${m.padEnd(16)} ${String(n).padStart(6)}`);
    }
    console.log(`\n${"─".repeat(102)}`);
    console.log(`${Math.min(SAMPLE, hits.length)} OFFERS TO READ — each is a live price on a page`);
    console.log("─".repeat(102));
    for (const h of hits.slice(0, SAMPLE)) {
      console.log(`  offer ${h.offerId} [${h.merchant}]  brand "${h.brand}" found inside "${h.carrier}"`);
      console.log(`     we say:   ${h.product.slice(0, 70)}`);
      console.log(`     they say: ${h.storeName.slice(0, 70)}`);
      console.log(`     /p/${h.slug}`);
    }
  }

  emitJson({
    brandedOffers: branded, substringOnly,
    share: Number((substringOnly / Math.max(1, branded)).toFixed(5)),
    byBrand: [...byBrand.entries()].map(([brand, n]) => ({ brand, n })),
    byMerchant: [...byMerchant.entries()].map(([merchant, n]) => ({ merchant, n })),
    sample: hits.slice(0, 200),
    pass: substringOnly === 0,
  });
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
