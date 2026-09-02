// ── SCOPE: DATA INTEGRITY ─────────────────────────────────────────────────────
// Does every pinned basket line still resolve, and to the product it was pinned to?
//
// The whole value of a fixed basket is that its composition cannot change without somebody
// deciding to change it. A slug that stops resolving, or that now points at a different product,
// breaks that silently — and a silent composition change is indistinguishable from inflation
// after the fact. So this is checked from OUTSIDE the page, and it does not import the page.
//
// Read-only. Run: npm run audit:basket

import { PrismaClient } from "@prisma/client";
import { INDEX_BASKET, BASKET_VERSION } from "../src/lib/index-basket";

const prisma = new PrismaClient();
const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const lp = (s: string | number, n: number): string => String(s).padStart(n);

async function main(): Promise<void> {
  console.log(`\n════ INDEX BASKET — v${BASKET_VERSION}, ${INDEX_BASKET.length} lines ══════════════════════════════════`);

  const rows = await prisma.product.findMany({
    where: { slug: { in: INDEX_BASKET.map((i) => i.slug) } },
    select: {
      slug: true, name: true, section: true,
      offers: {
        where: { availability: "in stock", flagged: false, isStale: false },
        select: { price: true, merchant: { select: { name: true } } },
      },
    },
  });
  const bySlug = new Map(rows.map((r) => [r.slug, r]));

  const missing: string[] = [];
  const renamed: string[] = [];
  const unpriced: string[] = [];
  let total = 0;

  console.log(`\n  ${pad("line", 22)}${pad("pack", 30)}${lp("cheapest", 10)}  magazin`);
  for (const item of INDEX_BASKET) {
    const p = bySlug.get(item.slug);
    if (!p) {
      missing.push(item.key);
      console.log(`  ${pad(item.key, 22)}${pad(item.label, 30)}${lp("PIN MISSING", 10)}`);
      continue;
    }
    if (p.name !== item.expectedName) renamed.push(`${item.key}: "${item.expectedName}" -> "${p.name}"`);
    const offers = p.offers.filter((o) => o.price > 0).sort((a, b) => a.price - b.price);
    if (offers.length === 0) {
      unpriced.push(item.key);
      console.log(`  ${pad(item.key, 22)}${pad(item.label, 30)}${lp("no price", 10)}`);
      continue;
    }
    total += offers[0].price;
    console.log(`  ${pad(item.key, 22)}${pad(item.label, 30)}${lp(offers[0].price.toFixed(2), 10)}  ${offers[0].merchant.name}`);
  }

  const priced = INDEX_BASKET.length - missing.length - unpriced.length;
  console.log(`\n  priced ${priced}/${INDEX_BASKET.length}   total ${total.toFixed(2)} lei`);

  // Duplicate keys or slugs would let one product count twice in the total.
  const dupKeys = INDEX_BASKET.map((i) => i.key).filter((k, i, a) => a.indexOf(k) !== i);
  const dupSlugs = INDEX_BASKET.map((i) => i.slug).filter((s, i, a) => a.indexOf(s) !== i);

  const problems: string[] = [];
  if (missing.length) problems.push(`${missing.length} pin(s) no longer resolve: ${missing.join(", ")}`);
  if (dupKeys.length) problems.push(`duplicate key(s): ${dupKeys.join(", ")}`);
  if (dupSlugs.length) problems.push(`duplicate slug(s): ${dupSlugs.join(", ")}`);
  if (renamed.length) {
    console.log(`\n  ⚠ ${renamed.length} pinned slug(s) now carry a DIFFERENT NAME than when pinned:`);
    for (const r of renamed) console.log(`      ${r}`);
    console.log(`    A slug that changed product is a composition change. Check each one, then`);
    console.log(`    either re-pin deliberately and bump BASKET_VERSION, or fix the catalog.`);
  }
  if (unpriced.length) {
    console.log(`\n  ${unpriced.length} line(s) resolve but have no live price today: ${unpriced.join(", ")}`);
    console.log(`    That is not a failure — the total is reported as incomplete and the day is`);
    console.log(`    excluded from comparisons. It IS a reason to re-pin if it persists.`);
  }

  console.log();
  if (problems.length) {
    for (const p of problems) console.log(`  ✗ ${p}`);
    console.log();
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log(`  ✓ every pin resolves, no duplicates\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
