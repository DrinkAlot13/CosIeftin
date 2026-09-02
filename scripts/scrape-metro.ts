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
import { matchPoolToCatalog, type StoreProduct } from "../src/lib/scrape-util";
import { notePageCap } from "../src/lib/truncation";

// No request may hang forever. `fetch` waits on a stalled connection indefinitely, and one
// such socket in the DCNeu detail pass stopped the whole nightly dead at 5,500 of 6,034
// products with the process using zero CPU — and because scrape-all runs stores in sequence,
// the three stores queued behind it never ran at all. Nothing crashed, so nothing reported it.
const REQUEST_TIMEOUT_MS = 20_000;

const BASE = "https://produse.metro.ro";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const STORE = "00036";
const ROWS = 100; // search rows per page
const MAX_PAGES = 45; // up to 4500 products/category
const BATCH = 20; // betty-variants ids per request

// Broad category filters (category:<urlCategoryPath>). "alimentare" covers all food
// incl. fresh; plus household + cosmetics for menaj matching.
const CATS = ["alimentare", "nealimentare/produse-pentru-curatenie", "nealimentare/cosmetice"];

// The pool IS the contract — no local shape, so no re-map at the matcher call.
type Cand = StoreProduct;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * In-page fetch (inherits session cookies + referer so the API accepts it).
 *
 * THE TIMEOUT IS PASSED IN, NOT CLOSED OVER. `page.evaluate` serializes this function and
 * runs it in the BROWSER, where Node module scope does not exist — so a bare reference to
 * `REQUEST_TIMEOUT_MS` throws ReferenceError inside the page, the catch turns it into
 * `{ __err }`, and the caller breaks out of pagination after page 1.
 *
 * That is exactly what happened. Commit 568d283 — "A stalled socket can silently cost the
 * whole night, and it just did" — added the timeout to this line while hardening every
 * fetch in the project, and thereby cost Metro every night from 31 August on: 0 products,
 * 5,296 live offers frozen. The drop guard did its job and refused each empty run rather
 * than wiping the data, which is the only reason this was recoverable — but nothing said
 * "this merchant has produced nothing for two days", so nobody looked.
 */
async function apiGet(page: Page, url: string): Promise<any> {
  return page.evaluate(async ({ u, timeoutMs }) => {
    try {
      const r = await fetch(u, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
      const t = await r.text();
      return t ? JSON.parse(t) : { __err: r.status };
    } catch (e) {
      return { __err: String(e) };
    }
  }, { u: url, timeoutMs: REQUEST_TIMEOUT_MS });
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
      if (p === MAX_PAGES) notePageCap(`${__filename.split(/[\/]/).pop()} page loop`, p, MAX_PAGES);
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
          pool.push({ name: meta.name, brand: meta.brand, sourceId: id, price: pr.price, available: pr.available, url: `${BASE}/shop/pv/${id}`, productUrl: `${BASE}/shop/pv/${id}`, rawPriceText: String(pr.price), rawSourceBlob: JSON.stringify({ meta, pr }).slice(0, 4096), image: meta.image });
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
  // Unmapped. The map that stood here listed the fields by hand, which is exactly how
  // productUrl and rawPriceText went missing the first time — the pool had them.
  const r = await matchPoolToCatalog(merchant.id, pool, { addNew: true, label: "metro" });
  console.log(`\nMetro: ${r.offers} offers (${r.created} new products) from pool ${pool.length}.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
