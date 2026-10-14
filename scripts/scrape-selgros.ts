// REAL scraper: Selgros (selgros.ro) — cash & carry, REPLACING the old homepage-carousel-only
// adapter (scripts/adapters/selgros.ts, still present for its hard-won per-kg/per-piece parsing
// notes, but no longer run).
//
// ── THE CATALOG WAS NEVER 45 PRODUCTS. That number was real for what the OLD scraper read (the
// homepage's "oferte" carousel, `a.product-item[data-product-id]`, ~64 cards) and the existing
// `LIMITED_CATALOG_MERCHANTS` note even said the full catalog "există doar cu cont de cumpărător
// en-gros" (wholesale account only). Checked live on 2026-10-14: `/exploreaza-sortimentul-
// selgros` is a REAL, PUBLIC, unauthenticated category tree, `robots.txt` does not disallow it,
// and it publishes its own product sitemap —
//
//     Sitemap: https://www.selgros.ro/sites/default/files/sitemaps/products-index.xml
//
// — which points at 3 child sitemaps totalling **16,755 product URLs**, each one a plain `curl`
// away with no login, no Cloudflare challenge, no JS rendering required. The wholesale-account
// claim was true of a DIFFERENT thing (ordering in bulk) and got generalised to "the catalog",
// which is the "two kinds of fact" shape CLAUDE.md warns about: nobody measured the public
// catalog directly, so a true fact about ordering stood in for a false fact about browsing.
//
// ── THE PRICE SHAPE. Every product page embeds one clean schema.org Product JSON-LD block
// (confirmed: always the FIRST `application/ld+json` script; the second is a BreadcrumbList).
// Its `offers` array repeats per PHYSICAL STORE (24 of them) and, within each store, up to 3
// quantity tiers — a base retail price (no `eligibleQuantity`) plus bulk-discount tiers
// (`eligibleQuantity.minValue` 4, 8, …). Checked on a real product: the base price was IDENTICAL
// across all 24 stores (8.59 lei, no variation) — this is national pricing, not per-store, so
// the first store's base-tier offer is read as THE price. Bulk tiers are real data this project
// already has infrastructure for (CLAUDE.md → "bulk tiers") but are NOT wired in here yet; a
// product with no base (no-`eligibleQuantity`) offer at all is skipped and counted, not guessed.
//
// Run: npm run scrape:selgros

import { prisma } from "../src/lib/db";
import { matchPoolToCatalog, type StoreProduct } from "../src/lib/scrape-util";

const BASE = "https://www.selgros.ro";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const REQUEST_TIMEOUT_MS = 20_000;
const CONCURRENCY = 5;
const SITEMAPS = [1, 2, 3].map((n) => `${BASE}/sites/default/files/sitemaps/products-${n}.xml`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type LdOffer = { price?: string; priceCurrency?: string; availability?: string; eligibleQuantity?: { minValue?: number } };
type LdProduct = { name?: string; sku?: string; image?: string; offers?: LdOffer[] };

async function discoverProductUrls(): Promise<string[]> {
  const urls = new Set<string>();
  for (const sm of SITEMAPS) {
    const res = await fetch(sm, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`sitemap ${sm} HTTP ${res.status}`);
    const xml = await res.text();
    for (const m of xml.matchAll(/<loc>([^<]*\/product\/[^<]*)<\/loc>/g)) urls.add(m[1]);
  }
  return [...urls];
}

async function fetchProduct(url: string): Promise<StoreProduct | null> {
  const res = await fetch(url, { headers: { "user-agent": UA, "accept-language": "ro-RO" }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) return null;
  const html = await res.text();
  const m = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  let data: LdProduct;
  try { data = JSON.parse(m[1]); } catch { return null; }
  if (!data.name || !Array.isArray(data.offers)) return null;

  // The base retail price: the first offer with NO eligibleQuantity (i.e. not a bulk-discount
  // tier). Confirmed identical across all 24 stores on a real product, so the first one found
  // is not a guess among several different answers — there is only one answer.
  const base = data.offers.find((o) => !o.eligibleQuantity?.minValue);
  if (!base?.price) return null;
  const price = Number(base.price);
  if (!Number.isFinite(price) || price <= 0) return null;

  return {
    name: data.name,
    brand: "",
    price,
    available: base.availability?.endsWith("InStock") ?? true,
    url,
    productUrl: url,
    sourceId: data.sku ?? null,
    rawPriceText: String(base.price),
    rawSourceBlob: JSON.stringify(data).slice(0, 4096),
    image: data.image ?? null,
  };
}

async function main() {
  const merchant = await prisma.merchant.upsert({
    where: { slug: "selgros" },
    update: { active: true, name: "Selgros", websiteUrl: BASE },
    create: { slug: "selgros", name: "Selgros", websiteUrl: BASE, priceChannel: "shelf", storeType: "hybrid" },
  });

  const urls = await discoverProductUrls();
  console.log(`Discovered ${urls.length} product URLs from the sitemap.`);

  const pool: StoreProduct[] = [];
  let noOffer = 0;
  let errors = 0;
  let next = 0;

  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= urls.length) return;
      try {
        const item = await fetchProduct(urls[i]);
        if (item) pool.push(item);
        else noOffer++;
      } catch {
        errors++;
      }
      if (pool.length % 1000 === 0 && pool.length > 0) console.log(`  ...${pool.length} parsed so far`);
      await sleep(150);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  console.log(`Pooled ${pool.length} Selgros products (${noOffer} with no usable base price, ${errors} fetch errors).`);

  const r = await matchPoolToCatalog(merchant.id, pool, { label: "selgros", addNew: true });
  console.log(`\nSelgros: ${r.offers} offers matched (pool ${pool.length}).`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
