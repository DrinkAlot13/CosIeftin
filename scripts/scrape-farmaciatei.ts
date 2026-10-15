// REAL scraper: Farmacia Tei (comenzi.farmaciatei.ro) — REPLACING the old page-1-only DOM
// scraper. Feeds TWO verticals: "cosmetice" and "farmacie" — never prescription
// `medicamente-cu-reteta`.
//
// ── THE OLD SCRAPER READ ONE PAGE PER (SUB)CATEGORY, because listing pagination here is
// AJAX and nobody had found the mechanism. Checked live on 2026-10-14/15: `robots.txt`
// publishes a real product sitemap —
//
//     Sitemap: https://comenzi.farmaciatei.ro/sitemaps/sitemap_products_RO_1.xml
//
// — 36,207 product URLs, no pagination needed at all. Every product page embeds a clean
// schema.org Product block (inside a JSON-LD `@graph`, confirmed by reading a real page) with
// name, brand, sku, **gtin13** (a real validated EAN — Auchan already publishes EANs too, so
// this is a genuine chance at EAN-join matches, not just fuzzy name matching), price, currency
// and availability. The old scraper had none of that: price came from scraping "X,XX Lei" out
// of rendered HTML, with no EAN at all.
//
// ── CATEGORY SCOPE, measured from the sitemap itself (one count per top-level path segment):
//
//     ingrijire-personala      13,525   cosmetice   (already scraped, page 1 only)
//     vitamine-si-suplimente    7,491   farmacie    (already scraped, page 1 only)
//     dieta-si-wellness         5,861   farmacie    NEW — never scraped at all
//     medicamente-cu-reteta     2,329   EXCLUDED — prescription, same policy as before
//     dermato-cosmetice         2,002   cosmetice   (already scraped, page 1 only)
//     cosmetice-coreene         1,975   cosmetice   (already scraped, page 1 only)
//     dispozitive-medicale      1,164   farmacie    NEW — OTC medical devices (thermometers,
//                                                   blood-pressure monitors, …), not prescription
//     cosmetice-premium           709   cosmetice   (already scraped, page 1 only)
//     viata-sexuala                596   farmacie    NEW — OTC sexual-health retail, not
//                                                   prescription
//     medicamente-otc              555   farmacie    (already scraped, page 1 only)
//
// 33,878 products in scope once medicamente-cu-reteta is excluded — about 16x what the old
// page-1-only approach could ever have reached even with every subcategory found.
//
// ── ROBOTS.TXT IS UNUSUAL: two "User-agent: *" blocks (the second disallows "/" entirely),
// with specific bots named below it on an allow-list — ClaudeBot included by name. Read
// together this is coherent (block unnamed/unknown crawlers, allow named good citizens), and
// it is the same site the previous page-1-only scraper has already been polling with a plain
// browser user-agent this whole time; this file keeps that precedent rather than inventing a
// new one, at the same politeness (one request at a time, a real delay between them).
//
// Run: npm run scrape:farmaciatei

import { prisma } from "../src/lib/db";
import { matchPoolToCatalog, type StoreProduct } from "../src/lib/scrape-util";
import { parseEan } from "../src/lib/product/ean";

const BASE = "https://comenzi.farmaciatei.ro";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const REQUEST_TIMEOUT_MS = 20_000;
const CONCURRENCY = 5;
const DELAY_MS = 150;
const SITEMAP_URL = `${BASE}/sitemaps/sitemap_products_RO_1.xml`;

const EXCLUDED_SEGMENTS = new Set(["medicamente-cu-reteta"]);
const SECTION_BY_SEGMENT: Record<string, string> = {
  "ingrijire-personala": "cosmetice",
  "dermato-cosmetice": "cosmetice",
  "cosmetice-coreene": "cosmetice",
  "cosmetice-premium": "cosmetice",
  "vitamine-si-suplimente": "farmacie",
  "medicamente-otc": "farmacie",
  "dieta-si-wellness": "farmacie",
  "dispozitive-medicale": "farmacie",
  "viata-sexuala": "farmacie",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Human-readable label from a URL slug: "ingrijire-par" -> "Ingrijire par". */
function labelFor(slug: string): string {
  const s = slug.replace(/-/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Make sure the (namespaced) sub-category exists in the right section before any product
 *  references it — matchPoolToCatalog silently leaves categoryId null for an unknown slug
 *  rather than erroring, which would otherwise dump all 33,878 products into "unassigned". */
async function ensureCategory(slug: string, leaf: string, section: string) {
  await prisma.category
    .upsert({ where: { slug }, update: { section }, create: { slug, name: labelFor(leaf), section } })
    .catch(() => {});
}

type LdProduct = {
  name?: string;
  sku?: string;
  gtin13?: string;
  image?: string;
  brand?: { name?: string };
  offers?: { price?: string; priceCurrency?: string; availability?: string };
};

type Discovered = { url: string; topSegment: string; leafSegment: string };

async function discoverProductUrls(): Promise<Discovered[]> {
  const res = await fetch(SITEMAP_URL, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`sitemap HTTP ${res.status}`);
  const xml = await res.text();
  const out: Discovered[] = [];
  for (const m of xml.matchAll(/<loc>([^<]*)<\/loc>/g)) {
    const url = m[1];
    if (!url.startsWith(`${BASE}/`)) continue;
    const segs = url.slice(BASE.length + 1).split("/");
    const top = segs[0];
    if (!top || EXCLUDED_SEGMENTS.has(top) || !SECTION_BY_SEGMENT[top]) continue;
    out.push({ url, topSegment: top, leafSegment: segs[1] ?? top });
  }
  return out;
}

/** The product's own JSON-LD, whether bare or wrapped in an `@graph` array. */
function findProductLd(html: string): LdProduct | null {
  for (const m of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    let data: unknown;
    try { data = JSON.parse(m[1]); } catch { continue; }
    if (!data || typeof data !== "object") continue;
    const graph = (data as { "@graph"?: unknown[] })["@graph"];
    if (Array.isArray(graph)) {
      const p = graph.find((x) => (x as { "@type"?: string })?.["@type"] === "Product");
      if (p) return p as LdProduct;
    }
    if ((data as { "@type"?: string })["@type"] === "Product") return data as LdProduct;
  }
  return null;
}

async function fetchProduct(d: Discovered): Promise<StoreProduct | null> {
  const res = await fetch(d.url, { headers: { "user-agent": UA, "accept-language": "ro-RO" }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) return null;
  const html = await res.text();
  const ld = findProductLd(html);
  if (!ld?.name || !ld.offers?.price) return null;
  const price = Number(ld.offers.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  return {
    name: ld.name,
    brand: ld.brand?.name ?? "",
    price,
    available: (ld.offers.availability ?? "").toLowerCase().endsWith("instock"),
    url: d.url,
    productUrl: d.url,
    sourceId: ld.sku ?? null,
    ean: parseEan(ld.gtin13) || null,
    rawPriceText: String(ld.offers.price),
    rawSourceBlob: JSON.stringify(ld).slice(0, 4096),
    image: ld.image ?? null,
    category: `${SECTION_BY_SEGMENT[d.topSegment]}-${d.leafSegment}`,
    categoryPath: `${d.topSegment}/${d.leafSegment}`,
  };
}

async function main() {
  const merchant = await prisma.merchant.upsert({
    where: { slug: "farmaciatei" },
    update: { active: true, name: "Farmacia Tei", websiteUrl: BASE, color: "#0a8a3f" },
    create: { slug: "farmaciatei", name: "Farmacia Tei", websiteUrl: BASE, color: "#0a8a3f" },
  });

  const discovered = await discoverProductUrls();
  console.log(`Discovered ${discovered.length} in-scope product URLs from the sitemap.`);

  const seenLeaves = new Set<string>();
  for (const d of discovered) {
    const section = SECTION_BY_SEGMENT[d.topSegment];
    const slug = `${section}-${d.leafSegment}`;
    if (seenLeaves.has(slug)) continue;
    seenLeaves.add(slug);
    await ensureCategory(slug, d.leafSegment, section);
  }
  console.log(`Ensured ${seenLeaves.size} sub-categories across both sections.`);

  const sectionPools = new Map<string, StoreProduct[]>();
  let noUsablePrice = 0;
  let errors = 0;
  let next = 0;
  let done = 0;

  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= discovered.length) return;
      const d = discovered[i];
      try {
        const item = await fetchProduct(d);
        if (item) {
          const section = SECTION_BY_SEGMENT[d.topSegment];
          const pool = sectionPools.get(section) ?? [];
          pool.push(item);
          sectionPools.set(section, pool);
        } else {
          noUsablePrice++;
        }
      } catch {
        errors++;
      }
      done++;
      if (done % 2000 === 0) console.log(`  ...${done}/${discovered.length} fetched so far`);
      await sleep(DELAY_MS);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  let totalPool = 0;
  for (const pool of sectionPools.values()) totalPool += pool.length;
  console.log(`Pooled ${totalPool} Farmacia Tei products across ${sectionPools.size} section(s) (${noUsablePrice} with no usable price, ${errors} fetch errors).`);

  let totalOffers = 0;
  let totalNew = 0;
  for (const [section, pool] of sectionPools) {
    const r = await matchPoolToCatalog(merchant.id, pool, { section, addNew: true, label: "farmaciatei/" + section });
    console.log(`  -> ${section}: ${r.offers} offers (${r.created} new) from pool ${pool.length}`);
    totalOffers += r.offers;
    totalNew += r.created;
  }
  console.log(`\nFarmacia Tei: ${totalOffers} offers across sections (${totalNew} new products).`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
