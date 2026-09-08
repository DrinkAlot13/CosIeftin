// ── SCOPE: LINKS ──────────────────────────────────────────────────────────────
// DOES THE SITEMAP ADVERTISE PAGES THAT DO NOT EXIST? READ-ONLY, and answered from the
// database rather than by fetching 324 URLs — the routing rule is knowable without asking the
// server 324 times.
//
// `src/app/sitemap.ts` emits `/c/<slug>` for EVERY category that has a live offer, with no
// section filter. `/c/[slug]` resolves through `getCategoryPage`, which is grocery-only and
// calls `notFound()` otherwise. So every non-grocery category in the sitemap is a 404 we are
// handing to Google.
//
// Same question for products: the sitemap emits `/p/<slug>` for products with a live offer.
// Those resolve for every section, so they should all be fine — reported anyway, because
// "should" is what this project keeps being wrong about.
//
//   npm run audit:sitemap

import { PrismaClient } from "@prisma/client";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();

/** The sitemap's own predicate, copied verbatim from src/app/sitemap.ts. */
const SITEMAP_LIVE = { isStale: false, merchant: { active: true } } as const;

async function main(): Promise<void> {
  const categories = await prisma.category.findMany({
    where: { products: { some: { offers: { some: SITEMAP_LIVE } } } },
    select: { slug: true, section: true, name: true },
  });

  const bySection = new Map<string, number>();
  for (const c of categories) bySection.set(c.section, (bySection.get(c.section) ?? 0) + 1);

  // `/c/[slug]` is grocery-only. Everything else in this list is a 404 in the sitemap.
  const broken = categories.filter((c) => c.section !== "grocery");

  console.log("═".repeat(96));
  console.log("SITEMAP vs WHAT /c/[slug] ACTUALLY SERVES");
  console.log("═".repeat(96));
  console.log(`  categories emitted into the sitemap   ${categories.length}`);
  for (const [s, n] of [...bySection.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${s.padEnd(12)} ${String(n).padStart(4)}${s === "grocery" ? "  ← the only section /c/[slug] serves" : "  ← 404"}`);
  }
  console.log(`\n  ADVERTISED BUT 404: ${broken.length} of ${categories.length} (${((broken.length / Math.max(1, categories.length)) * 100).toFixed(0)}%)`);
  console.log(`\n  first 15:`);
  for (const c of broken.slice(0, 15)) console.log(`    /c/${c.slug.padEnd(46)} [${c.section}] ${c.name}`);

  const products = await prisma.product.count({ where: { offers: { some: SITEMAP_LIVE } } });
  console.log(`\n  products emitted into the sitemap     ${products}  (/p/[slug] serves every section, so these resolve)`);

  // The sitemap ships in ONE file. Google's limits are 50,000 URLs and 50 MB uncompressed.
  const totalUrls = categories.length + products + 2;
  console.log(`\n  TOTAL URLs in one sitemap file        ${totalUrls}`);
  if (totalUrls > 50_000) console.log(`    ⚠ OVER GOOGLE'S 50,000-URL LIMIT for a single sitemap — it needs an index and splitting.`);
  else console.log(`    within Google's 50,000-URL limit.`);

  emitJson({
    categoriesInSitemap: categories.length,
    brokenCategoryUrls: broken.length,
    brokenSample: broken.slice(0, 40).map((c) => `/c/${c.slug}`),
    productsInSitemap: products,
    totalUrls,
    pass: broken.length === 0,
  });
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
