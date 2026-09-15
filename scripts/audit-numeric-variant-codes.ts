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
// The concept itself (`candidateCodes`, `findNumericCodeClusters`) lives in
// `src/lib/numeric-variant-codes.ts`, shared with `scripts/withhold-numeric-variant-codes.ts` —
// the two must count the exact same population, or "found 93" and "withheld 93" would quietly
// drift apart the way `audit:sitemap`'s copy of a predicate went stale (CLAUDE.md).
//
// ── TWO QUESTIONS, MEASURED SEPARATELY.
//
//   1. HOW MANY PRODUCTS CARRY ONE. A bare 2-4 digit token, stripped by overlapTokens, that does
//      not plausibly restate the product's own parsed size in any common unit scaling, and is not
//      already compared explicitly by doseTokens under a different name (N% / N mg/ui/mcg).
//   2. HOW MANY CURRENT MATCHES THIS IS ALREADY CORRUPTING. Reuses the exact (merchant,
//      storeName) grouping `audit:flyer-fanout` uses — the same detector, not a new one — but
//      narrows it to clusters whose member products are IDENTICAL once their numeric codes are
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
import { candidateCodes, findNumericCodeClusters } from "../src/lib/numeric-variant-codes";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();

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
  const clusters = await findNumericCodeClusters(prisma);
  const explainedOffers = clusters.reduce((a, c) => a + c.members.reduce((b, m) => b + m.offers.length, 0), 0);
  const physicalScoped = clusters.filter((c) => c.physicalScoped);
  const physicalScopedOffers = physicalScoped.reduce((a, c) => a + c.members.reduce((b, m) => b + m.offers.length, 0), 0);

  console.log(`\n${"─".repeat(100)}`);
  console.log(`  HOW MANY CURRENT MATCHES ARE ALREADY CORRUPTED BY THIS, RIGHT NOW`);
  console.log("─".repeat(100));
  console.log(`  clusters explained by numeric-code blindness specifically: ${clusters.length}`);
  console.log(`  live offers sitting inside those clusters: ${explainedOffers}`);
  console.log(`  of the explained clusters, on a storeType="physical" merchant (already withheld by`);
  console.log(`  the flyer-fanout rule — NOT newly exposed by fixing this): ${physicalScoped.length} cluster(s), ${physicalScopedOffers} offer(s)`);
  console.log(`  NOT already withheld by anything — live and wrong today: ${clusters.length - physicalScoped.length} cluster(s), ${explainedOffers - physicalScopedOffers} offer(s)`);

  console.log(`\n  ALL ${clusters.length} EXPLAINED CLUSTERS`);
  for (const c of clusters) {
    const prices = c.members.flatMap((m) => m.offers.map((o) => (o.priceBani != null ? o.priceBani / 100 : o.price)));
    const lo = Math.min(...prices), hi = Math.max(...prices);
    console.log(`\n  [${c.merchantName}] "${c.storeName}"  price ${lo === hi ? lo.toFixed(2) : `${lo.toFixed(2)}-${hi.toFixed(2)}`} lei${c.physicalScoped ? " [ALREADY WITHHELD — physical merchant]" : ""}`);
    for (const m of c.members) console.log(`      #${m.productId}  code=${m.code}  "${m.productName.slice(0, 60)}"`);
  }

  console.log(`\n  This is a lower bound: it only counts a cluster where 2+ products, EACH carrying a`);
  console.log(`  code, collapse to an identical name once their codes are removed. A product that`);
  console.log(`  fanned out for this reason AND carries one extra genuine word is not counted at all —`);
  console.log(`  a group differing by a code plus a real word elsewhere is a different discriminator.`);

  emitJson({
    pass: true,
    productsWithCode: withCode.size,
    bySection: Object.fromEntries(bySection),
    explainedByNumericCode: clusters.length,
    explainedOffers,
    alreadyWithheldPhysical: physicalScoped.length,
    liveAndUncorrected: clusters.length - physicalScoped.length,
  });
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
