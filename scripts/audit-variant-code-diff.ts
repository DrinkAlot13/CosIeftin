// ── FULL-CATALOG DIFF FOR THE variant-code-mismatch RULE. READ-ONLY.
//
// `variantCodeTokens()` (scrape-util.ts) now runs inside `decide()`, live, and can only turn a
// currently-confirmed pairing into a refusal — never the reverse, since it is a hard block
// checked alongside dose-mismatch/variant-mismatch. So the exact population it affects is
// computable from the LIVE catalog as it stands right now, with no re-scrape: for every live,
// matched (product, offer) pair with the offer's own parsed size on record (`ownUnit`/
// `ownUnitSize`), simulate `decide()` on it. Any pair `decide()` newly refuses is exactly what
// this rule is withholding starting with each merchant's next scrape.
//
// This is the "measure the blast radius across the whole catalog" CLAUDE.md asks for, done
// before the rule's next real scrape rather than assumed from the design-stage sample. The
// flyer-fanout rule's catalog-wide number came back at -1,852 against an expectation of
// "falls slightly" — assume nothing here either.
//
//   npm run audit:variant-code-diff

import { PrismaClient } from "@prisma/client";
import { decide, prep } from "../src/lib/scrape-util";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();

type OfferRow = {
  id: number; storeName: string | null; ownUnit: string | null; ownUnitSize: number | null;
  priceBani: number | null; price: number;
  merchant: { id: number; slug: string; name: string };
  product: { id: number; name: string; brand: string | null; unit: string; unitSize: number; ean: string | null; section: string };
};

async function comparabilityWith(withheldOfferIds: Set<number>) {
  const live = { merchant: { active: true }, isStale: false, flagged: false };
  const products = await prisma.product.findMany({
    where: { section: { in: ["grocery", "alcohol"] }, offers: { some: live } },
    select: { offers: { where: live, select: { id: true, merchantId: true } } },
  });
  const before = products.filter((pr) => new Set(pr.offers.map((o) => o.merchantId)).size >= 2).length;
  const after = products.filter((pr) => {
    const remaining = pr.offers.filter((o) => !withheldOfferIds.has(o.id));
    return new Set(remaining.map((o) => o.merchantId)).size >= 2;
  }).length;
  return { total: products.length, before, after };
}

async function main(): Promise<void> {
  const offers = (await prisma.offer.findMany({
    where: { isStale: false, flagged: false, storeName: { not: null }, ownUnit: { not: null }, ownUnitSize: { not: null } },
    select: {
      id: true, storeName: true, ownUnit: true, ownUnitSize: true, priceBani: true, price: true,
      merchant: { select: { id: true, slug: true, name: true } },
      product: { select: { id: true, name: true, brand: true, unit: true, unitSize: true, ean: true, section: true } },
    },
  })) as OfferRow[];

  const withoutOwnSize = await prisma.offer.count({ where: { isStale: false, flagged: false, storeName: { not: null }, OR: [{ ownUnit: null }, { ownUnitSize: null }] } });

  console.log("═".repeat(100));
  console.log("  variant-code-mismatch — FULL-CATALOG DIFF (live rule, next-scrape effect)");
  console.log("═".repeat(100));
  console.log(`  live matched offers with the store's own size on record: ${offers.length}`);
  console.log(`  live matched offers with NO store-side size on record (not simulatable, unaffected today): ${withoutOwnSize}`);

  const newlyRefused: { o: OfferRow; reason: string }[] = [];
  for (const o of offers) {
    const cat = prep(o.product.name, o.product.brand, o.product.ean);
    const st = prep(o.storeName!, null, null);
    const d = decide(cat, { unit: o.product.unit, unitSize: o.product.unitSize }, st, { unit: o.ownUnit!, unitSize: o.ownUnitSize! }, o.product.section);
    if (!d.ok && d.reason === "variant-code-mismatch") newlyRefused.push({ o, reason: d.reason });
  }

  const withheldIds = new Set(newlyRefused.map((r) => r.o.id));
  const comp = await comparabilityWith(withheldIds);

  console.log(`\n${"─".repeat(96)}`);
  console.log(`  OFFERS THE RULE NEWLY REFUSES`);
  console.log("─".repeat(96));
  console.log(`  ${newlyRefused.length} of ${offers.length} live matched pairs (${((newlyRefused.length / offers.length) * 100).toFixed(3)}%)`);
  console.log(`  grocery+alcohol comparable (2+ merchants): ${comp.before} -> ${comp.after} of ${comp.total}  (${comp.after - comp.before >= 0 ? "+" : ""}${comp.after - comp.before})`);

  const bySection = new Map<string, number>();
  for (const r of newlyRefused) bySection.set(r.o.product.section, (bySection.get(r.o.product.section) ?? 0) + 1);
  console.log(`\n  BY SECTION`);
  for (const [sec, n] of [...bySection.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${sec.padEnd(12)} ${n}`);

  const byMerchant = new Map<string, number>();
  for (const r of newlyRefused) byMerchant.set(r.o.merchant.name, (byMerchant.get(r.o.merchant.name) ?? 0) + 1);
  console.log(`\n  BY MERCHANT`);
  for (const [m, n] of [...byMerchant.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${m.padEnd(18)} ${n}`);

  console.log(`\n  ALL ${newlyRefused.length} REFUSED PAIRS`);
  for (const { o } of newlyRefused) {
    const price = o.priceBani != null ? `${(o.priceBani / 100).toFixed(2)} lei` : `${o.price} lei`;
    console.log(`\n  [${o.merchant.name}] catalog #${o.product.id} "${o.product.name.slice(0, 60)}" (${price})`);
    console.log(`      vs store "${o.storeName!.slice(0, 70)}"`);
  }

  emitJson({
    pass: true,
    liveMatchedOffersSimulated: offers.length,
    liveMatchedOffersUnsimulatable: withoutOwnSize,
    newlyRefused: newlyRefused.length,
    comparabilityBefore: comp.before,
    comparabilityAfter: comp.after,
    comparabilityTotal: comp.total,
    bySection: Object.fromEntries(bySection),
    byMerchant: Object.fromEntries(byMerchant),
  });
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
