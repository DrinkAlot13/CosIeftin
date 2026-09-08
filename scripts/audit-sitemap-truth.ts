// ── SCOPE: LINKS ──────────────────────────────────────────────────────────────
// DOES THE SITEMAP ADVERTISE PAGES THAT DO NOT EXIST? READ-ONLY, and answered from the
// database rather than by fetching 324 URLs — the routing rule is knowable without asking the
// server 324 times.
//
// ── THE DEFECT IT WAS WRITTEN FOR, NOW FIXED. `src/app/sitemap.ts` emitted `/c/<slug>` for
// EVERY category with a live offer and no section filter, while `/c/[slug]` resolves through
// `getCategoryPage`, which is grocery-only and calls `notFound()` otherwise — 246 of 324
// category URLs (76%) handed to Google as 404s. This is now the REGRESSION GUARD for that fix.
//
// Same question for products: the sitemap emits `/p/<slug>` for products with a live offer.
// Those resolve for every section, so they should all be fine — reported anyway, because
// "should" is what this project keeps being wrong about.
//
// ── TWO INSTRUMENTS, ONE SUBJECT, AND THEY ANSWER DIFFERENT QUESTIONS.
//
// This audit asks the DATABASE what the sitemap will emit, through the predicate the sitemap
// itself uses. `probe:sitemap` FETCHES the published sitemap and follows its URLs over HTTP.
// The first is cheap enough to run on every nightly; the second is the only one that can catch
// a break outside our own data — and it caught one immediately, because splitting the sitemap
// moved it off `/sitemap.xml` and left the URL in `robots.txt` pointing at a 404.
//
// They are kept from disagreeing by importing the same predicate rather than restating it. That
// restatement is precisely what went wrong here once already: this file used to carry its own
// copy, commented "copied verbatim", and went on reporting 246 dead URLs after they were fixed.
//
//   npm run audit:sitemap

import { PrismaClient } from "@prisma/client";
import { sitemapCategoryWhere, SITEMAP_SECTION, liveOfferWhere } from "../src/lib/sitemap-shape";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();

// THE PREDICATE IS IMPORTED, NOT COPIED. It used to be duplicated here with the comment
// "copied verbatim from src/app/sitemap.ts" — and when the sitemap gained its section filter,
// the copy did not. This audit then reported 246 dead URLs that had already been fixed, which
// is worse than reporting nothing: a check that cries wolf teaches its reader to ignore it.
const SITEMAP_LIVE = liveOfferWhere;

async function main(): Promise<void> {
  // What the sitemap ACTUALLY emits, through the shared predicate.
  const emitted = await prisma.category.findMany({
    where: sitemapCategoryWhere,
    select: { slug: true, section: true, name: true },
  });
  // Every category it COULD have emitted, so the report still shows what is being withheld and
  // why — the fix is only legible next to the thing it excluded.
  const categories = await prisma.category.findMany({
    where: { products: { some: { offers: { some: SITEMAP_LIVE } } } },
    select: { slug: true, section: true, name: true },
  });

  const bySection = new Map<string, number>();
  for (const c of categories) bySection.set(c.section, (bySection.get(c.section) ?? 0) + 1);
  const emittedBySection = new Map<string, number>();
  for (const c of emitted) emittedBySection.set(c.section, (emittedBySection.get(c.section) ?? 0) + 1);

  // THE INVARIANT: nothing the sitemap emits may be outside the section `/c/[slug]` serves.
  // Measured against what is EMITTED, not against what exists.
  const broken = emitted.filter((c) => c.section !== SITEMAP_SECTION);
  const withheld = categories.filter((c) => c.section !== SITEMAP_SECTION);

  console.log("═".repeat(96));
  console.log("SITEMAP vs WHAT /c/[slug] ACTUALLY SERVES");
  console.log("═".repeat(96));
  console.log(`  categories EMITTED into the sitemap   ${emitted.length}`);
  for (const [s, n] of [...emittedBySection.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${s.padEnd(12)} ${String(n).padStart(4)}${s === SITEMAP_SECTION ? "  ← the only section /c/[slug] serves" : "  ← 404 — SHOULD NOT BE HERE"}`);
  }

  console.log(`\n  categories WITHHELD (they exist, /c/ cannot serve them)   ${withheld.length}`);
  for (const [s, n] of [...bySection.entries()].filter(([s]) => s !== SITEMAP_SECTION).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${s.padEnd(12)} ${String(n).padStart(4)}  reachable instead at /${s === "alcohol" ? "alcool" : s}?cat=<slug>`);
  }

  if (broken.length === 0) {
    console.log(`\n  ✓ ADVERTISED BUT 404: 0. Every category URL in the sitemap resolves.`);
    console.log(`    This was 246 of 324 (76%) before the section filter landed.`);
  } else {
    console.log(`\n  ✗ ADVERTISED BUT 404: ${broken.length} of ${emitted.length} (${((broken.length / Math.max(1, emitted.length)) * 100).toFixed(0)}%)`);
    for (const c of broken.slice(0, 15)) console.log(`    /c/${c.slug.padEnd(46)} [${c.section}] ${c.name}`);
  }

  const products = await prisma.product.count({ where: { offers: { some: SITEMAP_LIVE } } });
  console.log(`\n  products emitted into the sitemap     ${products}  (/p/[slug] serves every section, so these resolve)`);

  // The sitemap ships in ONE file. Google's limits are 50,000 URLs and 50 MB uncompressed.
  const totalUrls = emitted.length + products + 13;
  console.log(`\n  TOTAL URLs in one sitemap file        ${totalUrls}`);
  if (totalUrls > 50_000) console.log(`    ⚠ OVER GOOGLE'S 50,000-URL LIMIT for a single sitemap — it needs an index and splitting.`);
  else console.log(`    within Google's 50,000-URL limit.`);

  emitJson({
    categoriesEmitted: emitted.length,
    categoriesWithheld: withheld.length,
    brokenCategoryUrls: broken.length,
    brokenSample: broken.slice(0, 40).map((c) => `/c/${c.slug}`),
    productsInSitemap: products,
    totalUrls,
    note: "counts what the sitemap EMITS, through the shared predicate in lib/sitemap-shape.ts — not a second copy of the routing rule",
    pass: broken.length === 0,
  });
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
