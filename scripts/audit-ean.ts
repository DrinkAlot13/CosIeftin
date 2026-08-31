// EAN coverage, and the number that actually matters: how many merchants back one product.
//
// A price comparator's whole value is "this product, at these N shops". If N is 1 for most of
// the catalog, there is nothing to compare and the site is a very elaborate product listing.
// So the merchants-per-product distribution is the headline metric for matching work, and it
// is reported before and after any change to the matcher.
//
// EAN is the join key that would make matching exact instead of inferred. The finding of an
// earlier session was that no Romanian grocery merchant publishes one — Mega Image's "valid
// EANs" turned out to be Unix timestamps. This audit checks that claim rather than repeating
// it: per merchant, how many offers carry an EAN, and how many of those SURVIVE a checksum.
//
// Read-only. Run: npm run audit:ean

import { PrismaClient } from "@prisma/client";
import { parseEan } from "../src/lib/product/ean";

const prisma = new PrismaClient();

const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const lpad = (s: string | number, n: number): string => String(s).padStart(n);

async function main(): Promise<void> {
  // ── the headline: merchants per product ─────────────────────────────────────────
  const products = await prisma.product.findMany({
    select: {
      section: true,
      ean: true,
      offers: {
        where: { isStale: false, merchant: { active: true } },
        select: { merchantId: true },
      },
    },
  });

  const live = products.filter((p) => p.offers.length > 0);
  const histogram = new Map<number, number>();
  const bySection = new Map<string, { products: number; comparable: number; merchantSum: number }>();

  for (const p of live) {
    const n = new Set(p.offers.map((o) => o.merchantId)).size;
    histogram.set(n, (histogram.get(n) ?? 0) + 1);
    const key = p.section ?? "(none)";
    const row = bySection.get(key) ?? { products: 0, comparable: 0, merchantSum: 0 };
    row.products++;
    row.merchantSum += n;
    if (n >= 2) row.comparable++;
    bySection.set(key, row);
  }

  const comparable = [...histogram.entries()].filter(([n]) => n >= 2).reduce((a, [, c]) => a + c, 0);
  const totalMerchantLinks = [...histogram.entries()].reduce((a, [n, c]) => a + n * c, 0);

  console.log("\n════ MERCHANTS PER PRODUCT — the headline matching metric ════════════════");
  console.log(`  products with a live offer   ${lpad(live.length, 8)}`);
  console.log(`  COMPARABLE (2+ merchants)    ${lpad(comparable, 8)}   ${((comparable / live.length) * 100).toFixed(1)}%`);
  console.log(`  mean merchants per product   ${lpad((totalMerchantLinks / live.length).toFixed(2), 8)}`);
  console.log("\n  DISTRIBUTION");
  const maxCount = Math.max(...histogram.values());
  for (const n of [...histogram.keys()].sort((a, b) => a - b)) {
    const c = histogram.get(n)!;
    const bar = "█".repeat(Math.max(1, Math.round((c / maxCount) * 44)));
    console.log(`  ${lpad(n, 3)} merchant${n === 1 ? " " : "s"}  ${lpad(c, 7)}  ${((c / live.length) * 100).toFixed(1).padStart(5)}%  ${bar}`);
  }

  console.log("\n  BY SECTION");
  console.log(`  ${pad("section", 14)}${lpad("products", 10)}${lpad("comparable", 12)}${lpad("share", 8)}${lpad("mean", 7)}`);
  for (const [k, r] of [...bySection.entries()].sort((a, b) => b[1].products - a[1].products)) {
    console.log(
      `  ${pad(k, 14)}${lpad(r.products, 10)}${lpad(r.comparable, 12)}` +
      `${lpad(((r.comparable / r.products) * 100).toFixed(1) + "%", 8)}${lpad((r.merchantSum / r.products).toFixed(2), 7)}`,
    );
  }

  // ── EAN coverage, per merchant, checked rather than assumed ─────────────────────
  const merchants = await prisma.merchant.findMany({
    where: { active: true },
    select: {
      slug: true, name: true,
      offers: { select: { product: { select: { ean: true } } } },
    },
  });

  console.log("\n════ EAN COVERAGE — is the join key actually there? ══════════════════════");
  console.log(`  ${pad("merchant", 16)}${lpad("offers", 9)}${lpad("has ean", 10)}${lpad("VALID", 9)}${lpad("valid %", 9)}`);
  let anyValid = 0;
  for (const m of merchants) {
    if (m.offers.length === 0) continue;
    let present = 0;
    let valid = 0;
    for (const o of m.offers) {
      const raw = o.product.ean;
      if (raw && String(raw).trim()) present++;
      if (parseEan(raw ?? null)) valid++;
    }
    anyValid += valid;
    console.log(
      `  ${pad(m.slug, 16)}${lpad(m.offers.length, 9)}${lpad(present, 10)}${lpad(valid, 9)}` +
      `${lpad(((valid / m.offers.length) * 100).toFixed(1) + "%", 9)}`,
    );
  }

  const withEan = products.filter((p) => parseEan(p.ean ?? null)).length;
  console.log(`\n  catalog products with a CHECKSUM-VALID EAN: ${withEan} / ${products.length}` +
    `  (${((withEan / products.length) * 100).toFixed(1)}%)`);

  if (anyValid === 0) {
    console.log("\n  No merchant supplies a usable EAN. Matching stays name+brand+size based, and");
    console.log("  an EAN join is not a lever we can pull — which is worth knowing definitively");
    console.log("  rather than assuming, in either direction.");
  } else {
    // Where an EAN exists on 2+ merchants it is a free, exact join. Count the opportunity.
    const byEan = new Map<string, Set<number>>();
    for (const p of products) {
      const e = parseEan(p.ean ?? null);
      if (!e) continue;
      const set = byEan.get(e) ?? new Set<number>();
      for (const o of p.offers) set.add(o.merchantId);
      byEan.set(e, set);
    }
    const joinable = [...byEan.values()].filter((s) => s.size >= 2).length;
    console.log(`\n  EANs already backed by 2+ merchants: ${joinable}. These are exact joins available for free.`);
  }
  console.log();
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
