// REAL scraper: Metro (produse.metro.ro — the METRO cash & carry online catalog).
// NOTE: Metro is wholesale/B2C cash & carry — many articles are bulk multipacks
// (e.g. "6 x 1 L") at with-VAT shelf prices. The catalog's size-guard naturally keeps
// only comparable single-unit sizes when matching, so bulk packs mostly drop out.
//
// The site is a JS SPA with a clean JSON API (no Cloudflare). We drive Chromium
// (Playwright) so the session cookies make both calls work, then replay in-page:
//   1) searchdiscover/articlesearch/search  -> resultIds + price + availability
//   2) evaluate.article.v1/betty-variants   -> name + brand + image per id
//
// Run: npm run scrape:metro

import { chromium, type Page } from "playwright";
import { prisma } from "../src/lib/db";
import { matchPoolToCatalog } from "../src/lib/scrape-util";

const BASE = "https://produse.metro.ro";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const STORE = "00036";
const ROWS = 100; // search rows per page
const MAX_PAGES = 45; // up to 4500 products/category
const BATCH = 20; // betty-variants ids per request

// Broad category filters (category:<urlCategoryPath>). "alimentare" covers all food
// incl. fresh; plus household + cosmetics for menaj matching.
const CATS = ["alimentare", "nealimentare/produse-pentru-curatenie", "nealimentare/cosmetice"];

type Cand = { name: string; brand: string; code: string; price: number; available: boolean; url: string; image: string | null ; productUrl?: string | null; rawPriceText?: string | null };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** In-page fetch (inherits session cookies + referer so the API accepts it). */
async function apiGet(page: Page, url: string): Promise<any> {
  return page.evaluate(async (u) => {
    try {
      const r = await fetch(u, { headers: { accept: "application/json" } });
      const t = await r.text();
      return t ? JSON.parse(t) : { __err: r.status };
    } catch (e) {
      return { __err: String(e) };
    }
  }, url);
}

function searchUrl(category: string, page: number): string {
  const filter = encodeURIComponent(`category:${category}`);
  return `${BASE}/searchdiscover/articlesearch/search?storeId=${STORE}&language=ro-RO&country=RO&query=*&rows=${ROWS}&page=${page}&filter=${filter}&facets=false&categories=false&__t=${Date.now()}`;
}

function bettyUrl(ids: string[]): string {
  // country + locale are REQUIRED (without them the endpoint 400s / returns empty).
  return `${BASE}/evaluate.article.v1/betty-variants?storeIds=${STORE}&country=RO&locale=ro-RO&${ids.map((id) => "ids=" + encodeURIComponent(id)).join("&")}&__t=${Date.now()}`;
}

function firstImage(o: any): string | null {
  let img: string | null = null;
  (function walk(x: any, d: number) {
    if (img || !x || typeof x !== "object" || d > 8) return;
    if (Array.isArray(x)) { for (const y of x) walk(y, d + 1); return; }
    for (const k of Object.keys(x)) {
      const v = x[k];
      if (!img && typeof v === "string" && /^https?:\/\/.*\.(jpe?g|png|webp)/i.test(v)) { img = v; return; }
      walk(v, d + 1);
    }
  })(o, 0);
  return img;
}

/** Map each betty article's variants to { resultId -> {name, brand, image} }. */
function indexBetty(json: any, out: Map<string, { name: string; brand: string; image: string | null }>) {
  const result = json?.result;
  if (!result || typeof result !== "object") return;
  for (const art of Object.values<any>(result)) {
    if (!art || !art.variants) continue;
    const brand = art.brandName || "";
    for (const v of Object.values<any>(art.variants)) {
      const rid = v?.bettyVariantId?.bettyVariantId;
      if (rid && v.description) out.set(String(rid), { name: v.description, brand, image: firstImage(v) });
    }
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ userAgent: UA, locale: "ro-RO", viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => { (globalThis as unknown as { __name: (f: unknown) => unknown }).__name = (f) => f; });

  // Establish the session (store cookie) so the in-page API calls are accepted.
  await page.goto(`${BASE}/shop/category/alimentare/bacanie`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(6000);

  const pool: Cand[] = [];
  const seen = new Set<string>();

  for (const cat of CATS) {
    // 1) collect resultIds + price + availability across pages
    const priced = new Map<string, { price: number; available: boolean }>();
    let totalPages = 1;
    for (let p = 1; p <= MAX_PAGES; p++) {
      const j = await apiGet(page, searchUrl(cat, p));
      if (!j || j.__err) break;
      totalPages = j.totalPages ?? 1;
      const results = j.results || {};
      for (const id of j.resultIds || []) {
        const r = results[id];
        if (r && typeof r.price === "number" && r.price > 0 && !priced.has(id)) priced.set(id, { price: r.price, available: r.isAvailable !== false });
      }
      if (p >= totalPages) break;
      await sleep(250);
    }

    // 2) fetch names/brands/images in batches, join with prices, add to pool
    const ids = [...priced.keys()];
    let catAdded = 0;
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH);
      const j = await apiGet(page, bettyUrl(batch));
      if (j && !j.__err) {
        const info = new Map<string, { name: string; brand: string; image: string | null }>();
        indexBetty(j, info);
        for (const id of batch) {
          const meta = info.get(id);
          const pr = priced.get(id)!;
          if (!meta || seen.has(id)) continue;
          seen.add(id);
          pool.push({ name: meta.name, brand: meta.brand, code: id, price: pr.price, available: pr.available, url: `${BASE}/shop/pv/${id}`, productUrl: `${BASE}/shop/pv/${id}`, rawPriceText: String(pr.price), image: meta.image });
          catAdded++;
        }
      }
      await sleep(250);
    }
    console.log(`  ${cat.padEnd(38)} +${catAdded} (pool ${pool.length}, ${totalPages}p, ${ids.length} priced)`);
  }
  await browser.close();
  console.log(`Pooled ${pool.length} Metro products.`);

  const merchant = await prisma.merchant.upsert({
    where: { slug: "metro" },
    update: { active: true, name: "Metro", websiteUrl: BASE, color: "#003d7d" },
    create: { slug: "metro", name: "Metro", websiteUrl: BASE, color: "#003d7d" },
  });
  const r = await matchPoolToCatalog(
    merchant.id,
    // Carry provenance explicitly. Re-mapping the pool into a narrower object here is
    // how productUrl and rawPriceText were silently dropped: the fields were set on the
    // pool, and this line quietly discarded them on the way to the matcher.
    pool.map((c) => ({ name: c.name, brand: c.brand, price: c.price, available: c.available, url: c.url, productUrl: c.productUrl ?? c.url, rawPriceText: c.rawPriceText ?? String(c.price), image: c.image })),
    { addNew: true },
  );
  console.log(`\nMetro: ${r.offers} offers (${r.created} new products) from pool ${pool.length}.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
