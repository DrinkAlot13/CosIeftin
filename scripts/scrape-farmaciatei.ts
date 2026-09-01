// REAL scraper: Farmacia Tei (comenzi.farmaciatei.ro) — open (no Cloudflare). Feeds TWO
// verticals: "cosmetice" (dermato/premium/korean/personal-care) and "farmacie" (OTC +
// vitamins/supplements ONLY — never prescription `medicamente-cu-reteta`). Custom theme:
// `.product-item` cards, name in the `.item-title` anchor, price = "X,XX Lei", image from
// media.farmaciatei.ro. First page per (sub)category (listing pagination is AJAX — a
// deeper pass is a follow-up).
//
// Run: npm run scrape:farmaciatei

import { parsePriceLei } from "../src/lib/price/parsePrice";
import { prisma } from "../src/lib/db";
import { matchPoolToCatalog, type StoreProduct } from "../src/lib/scrape-util";

// No request may hang forever. `fetch` waits on a stalled connection indefinitely, and one
// such socket in the DCNeu detail pass stopped the whole nightly dead at 5,500 of 6,034
// products with the process using zero CPU — and because scrape-all runs stores in sequence,
// the three stores queued behind it never ran at all. Nothing crashed, so nothing reported it.
const REQUEST_TIMEOUT_MS = 20_000;

const BASE = "https://comenzi.farmaciatei.ro";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MAX_SUBS = 24; // subcategories per top category
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const TOP_CATS: { top: string; section: string }[] = [
  { top: "dermato-cosmetice", section: "cosmetice" },
  { top: "cosmetice-premium", section: "cosmetice" },
  { top: "cosmetice-coreene", section: "cosmetice" },
  { top: "ingrijire-personala", section: "cosmetice" },
  { top: "medicamente-otc", section: "farmacie" },
  { top: "vitamine-si-suplimente", section: "farmacie" },
];

async function getHtml(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, "accept-language": "ro-RO" }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

function parseProducts(html: string): StoreProduct[] {
  const out: StoreProduct[] = [];
  const blocks = html.split(/class="product-item/).slice(1);
  for (const b0 of blocks) {
    const b = b0.slice(0, 3200);
    const t = b.match(/<a[^>]*class="[^"]*item-title[^"]*"[^>]*href="([^"]+)"[^>]*>\s*([^<]+?)\s*<\/a>/i);
    const url = t ? t[1] : (b.match(/class="product-image-listing"[^>]*href="([^"]+)"/i) || [])[1];
    const name = t ? t[2].replace(/&amp;/g, "&").replace(/\s+/g, " ").trim() : "";
    const priceM = b.match(/>\s*([\d.]*\d,\d{2})\s*Lei/i) || b.match(/data-price="([\d.,]+)"/i);
    const price = (priceM ? parsePriceLei(priceM[1]) : null) ?? 0;
    const img = (b.match(/srcset="(https:\/\/media\.farmaciatei\.ro\/[^" ]+)/i) || [])[1] || null;
    if (!url || !name || !(price > 0)) continue;
    out.push({ name, brand: "", price, available: true, url, productUrl: url, rawPriceText: priceM ? priceM[1] : null, rawSourceBlob: JSON.stringify({ name, price, url, raw: priceM ? priceM[0] : null }).slice(0, 4096), image: img });
  }
  return out;
}

/** Human-readable label from a URL slug: "ingrijire-par" -> "Ingrijire par". */
function labelFor(slug: string): string {
  const s = slug.replace(/-/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Make sure the sub-category exists in the right section before products reference it. */
async function ensureCategory(slug: string, leaf: string, section: string) {
  await prisma.category
    .upsert({ where: { slug }, update: { section }, create: { slug, name: labelFor(leaf), section } })
    .catch(() => {});
}

async function scrapeInto(sectionPool: Map<string, StoreProduct[]>, top: string, section: string) {
  const seen = sectionPool.get(section) ? new Set(sectionPool.get(section)!.map((p) => p.url)) : new Set<string>();
  const pool = sectionPool.get(section) ?? [];
  sectionPool.set(section, pool);

  const topHtml = await getHtml(`${BASE}/${top}/`);
  if (!topHtml) return;
  // subcategory URLs under this top category
  const subs = [...new Set([...topHtml.matchAll(new RegExp(`href="(https://comenzi\\.farmaciatei\\.ro/${top}/[a-z0-9-]+/)"`, "gi"))].map((m) => m[1]))].slice(0, MAX_SUBS);
  const urls = [`${BASE}/${top}/`, ...subs];
  let added = 0;
  for (const u of urls) {
    const html = await getHtml(u);
    if (!html) continue;
    // Tag each product with the sub-category it was found under, so Cosmetice/Farmacie get
    // a real taxonomy instead of one flat list. Category slugs are namespaced per section
    // to avoid colliding with grocery ones ("ingrijire-personala" exists in both worlds).
    const leaf = u.replace(/\/$/, "").split("/").pop() ?? top;
    const catSlug = `${section}-${leaf}`;
    for (const pr of parseProducts(html)) {
      if (seen.has(pr.url)) continue;
      seen.add(pr.url);
      pool.push({ ...pr, category: catSlug });
      added++;
    }
    await ensureCategory(catSlug, leaf, section);
    await sleep(350);
  }
  console.log(`  ${top.padEnd(24)} [${section}] +${added} (section pool ${pool.length})`);
}

async function main() {
  const merchant = await prisma.merchant.upsert({
    where: { slug: "farmaciatei" },
    update: { active: true, name: "Farmacia Tei", websiteUrl: BASE, color: "#0a8a3f" },
    create: { slug: "farmaciatei", name: "Farmacia Tei", websiteUrl: BASE, color: "#0a8a3f" },
  });

  const sectionPool = new Map<string, StoreProduct[]>();
  for (const c of TOP_CATS) await scrapeInto(sectionPool, c.top, c.section);

  let totalOffers = 0;
  let totalNew = 0;
  for (const [section, pool] of sectionPool) {
    const r = await matchPoolToCatalog(merchant.id, pool, { section, addNew: true, label: "farmaciatei/" + section });
    console.log(`  -> ${section}: ${r.offers} offers (${r.created} products) from pool ${pool.length}`);
    totalOffers += r.offers;
    totalNew += r.created;
  }
  console.log(`\nFarmacia Tei: ${totalOffers} offers across sections (${totalNew} products).`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
