// Unassign the domain-shaped "brands" `backfill-detail-brands.ts` wrote before
// `isNotABrand()` learned to reject a merchant's own domain (src/lib/brand/from-detail-page.ts).
//
// CLAUDE.md: "A SCRIPT THAT ASSIGNS MUST BE ABLE TO UNASSIGN." The assigner is fixed; this is
// the clear-then-write half — scoped to exactly what the OLD rule wrongly assigned, not to
// every brand this backfill ever wrote (Carrefour's real "Carrefour Classic"/"Carrefour
// Sensation" private-label lines must survive).
//
// A row qualifies for unassignment when its brand value, once lowercased and www-stripped,
// equals the HOSTNAME of a merchant that actually has a live offer on that product — not a
// bare "looks like a domain" pattern match, so a coincidentally domain-shaped REAL brand could
// not be swept up by accident (none exist today; this is future-proofing the unassign, not
// hedging against a known case).
//
// Run: npx tsx scripts/unassign-domain-brands.ts [--apply]

import { prisma } from "../src/lib/db";

const stripWww = (h: string): string => h.toLowerCase().replace(/^www\./, "");

function hostnameOf(url: string): string | null {
  try { return stripWww(new URL(url).hostname); } catch { return null; }
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  console.log(`\n════ UNASSIGN DOMAIN-SHAPED BRANDS ${apply ? "" : "(DRY RUN)"} ═══════════════════════════════\n`);

  const merchants = await prisma.merchant.findMany({ select: { id: true, slug: true, name: true, websiteUrl: true } });
  const hostByMerchantId = new Map(merchants.map((m) => [m.id, hostnameOf(m.websiteUrl)]));

  const marks = await prisma.productAttribute.findMany({
    where: { key: "brand", source: "merchant-detail" },
    select: { productId: true, value: true },
  });

  const products = await prisma.product.findMany({
    where: { id: { in: marks.map((m) => m.productId) } },
    select: { id: true, name: true, brand: true, offers: { select: { merchantId: true } } },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  const toClear: { productId: number; name: string; brand: string; merchantSlug: string }[] = [];
  for (const m of marks) {
    const p = byId.get(m.productId);
    if (!p) continue;
    const brandNorm = stripWww(m.value);
    const hitMerchantId = [...new Set(p.offers.map((o) => o.merchantId))].find((mid) => hostByMerchantId.get(mid) === brandNorm);
    if (hitMerchantId == null) continue;
    const merchant = merchants.find((mm) => mm.id === hitMerchantId)!;
    toClear.push({ productId: p.id, name: p.name, brand: m.value, merchantSlug: merchant.slug });
  }

  console.log(`  ${marks.length} merchant-detail brand assignments checked.`);
  console.log(`  ${toClear.length} name their own merchant's domain as the brand.\n`);

  const byMerchant = new Map<string, number>();
  for (const t of toClear) byMerchant.set(t.merchantSlug, (byMerchant.get(t.merchantSlug) ?? 0) + 1);
  for (const [slug, n] of byMerchant) console.log(`    ${slug.padEnd(14)} ${n}`);

  console.log(`\n  SAMPLE (10 of ${toClear.length}):`);
  for (const t of toClear.slice(0, 10)) console.log(`    #${t.productId} brand="${t.brand}" [${t.merchantSlug}] "${t.name.slice(0, 55)}"`);

  if (!apply) {
    console.log(`\n  DRY RUN — nothing written. Re-run with --apply.`);
    await prisma.$disconnect();
    return;
  }

  let cleared = 0;
  for (const t of toClear) {
    await prisma.product.update({ where: { id: t.productId }, data: { brand: null } });
    await prisma.productAttribute.deleteMany({ where: { productId: t.productId, key: "brand", source: "merchant-detail" } });
    cleared++;
  }
  console.log(`\n  ✓ ${cleared} product(s) unassigned. Reversible: re-run backfill:detail-brands for the affected merchant(s) — the fixed isNotABrand() will not reassign the same value.`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
