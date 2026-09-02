// Ingest delivery-platform storefronts through the SAME write path as every other merchant.
//
// No parallel path: the pool goes to `matchPoolToCatalog` unmapped, which is what applies the
// pool contract, the price gates, PriceAnomaly recording via record-refusal, the 60% drop guard
// and the ScraperRun row that liveness reads. Four separate bugs in this project came from a
// scraper that wrote its own way; this one does not get to.
//
// Run: npm run scrape:platform                    (every enabled storefront)
//      npm run scrape:platform -- glovo-kaufland-buc
//      npm run scrape:platform -- --dry           (scrape and report, write nothing)

import { prisma } from "../src/lib/db";
import { matchPoolToCatalog } from "../src/lib/scrape-util";
import { enabledStorefronts, storefrontByKey, type StorefrontConfig } from "../src/lib/platform/config";
import { scrapeStorefront } from "./adapters/glovo";

const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));

/** The merchant row a storefront writes to, created on first run with delivery economics. */
async function ensureMerchant(cfg: StorefrontConfig): Promise<number> {
  const existing = await prisma.merchant.findUnique({ where: { slug: cfg.merchantSlug }, select: { id: true } });
  if (existing) return existing.id;
  const m = await prisma.merchant.create({
    data: {
      slug: cfg.merchantSlug,
      name: cfg.merchantName,
      websiteUrl: `https://glovoapp.com/ro/ro/${cfg.city}/stores/${cfg.storeSlug}`,
      // `aggregator` is the MERCHANT vocabulary — how prices reach us. The OFFER vocabulary
      // value is DELIVERY_PLATFORM, set per product by the adapter. See lib/price-source.
      priceChannel: "aggregator",
      storeType: "online",
      active: true,
    },
    select: { id: true },
  });
  console.log(`  created merchant ${cfg.merchantSlug} (id ${m.id}, priceChannel=aggregator)`);
  return m.id;
}

async function run(cfg: StorefrontConfig, dry: boolean): Promise<void> {
  console.log(`\n════ ${cfg.key} ════════════════════════════════════════════════════════`);
  const t0 = Date.now();
  const res = await scrapeStorefront(cfg);
  const secs = ((Date.now() - t0) / 1000).toFixed(0);

  console.log(`\n  store: ${res.storeName ?? "(no h1)"}`);
  if (res.priceClaim) console.log(`  platform's own pricing claim: "${res.priceClaim}"`);
  console.log(`  categories: ${res.categoriesScraped}/${res.categoriesDiscovered} scraped`);
  console.log(`  pool: ${res.pool.length} products in ${secs}s`);

  const withRaw = res.pool.filter((p) => p.rawPriceText).length;
  const withBlob = res.pool.filter((p) => p.rawSourceBlob).length;
  const withUrl = res.pool.filter((p) => p.productUrl).length;
  const withImg = res.pool.filter((p) => p.image).length;
  const oos = res.pool.filter((p) => !p.available).length;
  console.log(`  provenance: rawPriceText ${withRaw}/${res.pool.length} · blob ${withBlob} · productUrl ${withUrl} · image ${withImg} · out of stock ${oos}`);

  if (res.pool.length === 0) {
    console.log("  nothing scraped — refusing to write.");
    return;
  }
  if (dry) {
    console.log("\n  DRY RUN — nothing written.");
    console.log("  sample:");
    for (const p of res.pool.slice(0, 8)) console.log(`    ${pad(p.name, 56)} ${String(p.price).padStart(8)}  ${p.rawPriceText}`);
    return;
  }

  const merchantId = await ensureMerchant(cfg);
  // UNMAPPED. The pool IS the contract — no local object literal at the call site.
  const result = await matchPoolToCatalog(merchantId, res.pool, {
    section: cfg.section,
    addNew: true,
    label: cfg.key,
  });
  console.log(`\n  written: ${JSON.stringify(result).slice(0, 300)}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const keys = args.filter((a) => !a.startsWith("--"));
  const targets = keys.length > 0
    ? keys.map((k) => { const c = storefrontByKey(k); if (!c) throw new Error(`unknown storefront: ${k}`); return c; })
    : enabledStorefronts();

  if (targets.length === 0) { console.log("No enabled storefronts."); await prisma.$disconnect(); return; }
  console.log(`Storefronts: ${targets.map((t) => t.key).join(", ")}${dry ? "  (DRY RUN)" : ""}`);

  for (const cfg of targets) {
    try { await run(cfg, dry); }
    catch (e) { console.error(`  ✗ ${cfg.key}: ${(e as Error).message}`); }
  }
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
