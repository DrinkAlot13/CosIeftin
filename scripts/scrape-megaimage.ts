// REAL scraper: Mega Image (mega-image.ro — SAP Hybris + Apollo GraphQL, behind
// Akamai bot manager and store-gated). Plain fetch won't work (needs a real browser
// session + a selected store), so we drive a real Chromium (Playwright): navigate a
// category page ONCE to establish the Akamai/store session, then REPLAY the site's own
// GetCategoryProductSearch persisted-query (a GET) in-page, paginating pageNumber
// through every page of every top category (plainChildCategories pulls their subcats).
//
// Run: npm run scrape:megaimage   (Playwright + Chromium must be installed)

import { chromium, type Page } from "playwright";
import { prisma } from "../src/lib/db";
import { matchPoolToCatalog, type StoreProduct } from "../src/lib/scrape-util";
import { readVariableWeight } from "../src/lib/price/variable-weight";

// No request may hang forever. `fetch` waits on a stalled connection indefinitely, and one
// such socket in the DCNeu detail pass stopped the whole nightly dead at 5,500 of 6,034
// products with the process using zero CPU — and because scrape-all runs stores in sequence,
// the three stores queued behind it never ran at all. Nothing crashed, so nothing reported it.
const REQUEST_TIMEOUT_MS = 20_000;

const BASE = "https://www.mega-image.ro";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
// Persisted-query hash for GetCategoryProductSearch (captured from the live site).
const HASH = "d8bff3916275ffeb6f51604d36d7a3aa2f9cd92847487a7f2e3bdf6bb2115cdd";
const PAGE_SIZE = 20; // the API rejects pageSize > 20 (HTTP 500), so we page through
const MAX_PAGES = 65; // safety cap (up to 1300 products/category)

// Top-level category code + URL path (plainChildCategories includes their subcategories).
const CATS = [
  { code: "001", path: "Fructe-si-legume-proaspete" },
  { code: "002", path: "Lactate-si-oua" },
  { code: "003", path: "Mezeluri-carne-si-ready-meal" },
  { code: "005", path: "Paine-cafea-cereale-si-mic-dejun" },
  { code: "006", path: "Dulciuri-si-snacks" },
  { code: "007", path: "Ingrediente-culinare" },
  { code: "008", path: "Apa-si-sucuri" },
  { code: "009", path: "Bauturi-si-tutun" },
  { code: "012", path: "Cosmetice-si-ingrijire-personala" },
  { code: "013", path: "Curatenie-si-nealimentare" },
];

// The pool IS the contract — no local shape, so no re-map at the matcher call.
type Cand = StoreProduct;

function firstImage(images: unknown): string | null {
  if (!Array.isArray(images)) return null;
  const primary = images.filter((i) => i.imageType === "PRIMARY");
  const pick = primary.find((i) => i.format === "small") || primary.find((i) => i.format === "respListGrid") || primary[0] || images[0];
  if (!pick?.url) return null;
  return pick.url.startsWith("http") ? pick.url : BASE + pick.url;
}

function apiUrl(category: string, pageNumber: number): string {
  const variables = { lang: "ro", searchQuery: "", category, pageNumber, pageSize: PAGE_SIZE, filterFlag: true, fields: "PRODUCT_TILE", plainChildCategories: true };
  const extensions = { persistedQuery: { version: 1, sha256Hash: HASH } };
  return `${BASE}/api/v1/?operationName=GetCategoryProductSearch&variables=${encodeURIComponent(JSON.stringify(variables))}&extensions=${encodeURIComponent(JSON.stringify(extensions))}`;
}

/**
 * Replay the persisted query in-page (carries the session cookies + Akamai token).
 *
 * THE TIMEOUT IS PASSED IN, NOT CLOSED OVER — see the same note in `scrape-metro.ts`.
 * `page.evaluate` runs this in the BROWSER, where Node module scope does not exist, so a
 * bare `REQUEST_TIMEOUT_MS` throws ReferenceError inside the page and every request returns
 * `{ __err }`. Commit 568d283 introduced it here and in Metro at the same time.
 */
async function fetchPage(page: Page, category: string, pageNumber: number): Promise<any> {
  const url = apiUrl(category, pageNumber);
  return page.evaluate(async ({ u, timeoutMs }) => {
    try {
      const r = await fetch(u, { headers: { "apollographql-client-name": "ro-mi-web-stores", "x-apollo-operation-name": "GetCategoryProductSearch" }, signal: AbortSignal.timeout(timeoutMs) });
      return r.ok ? await r.json() : { __err: r.status };
    } catch (e) {
      return { __err: String(e) };
    }
  }, { u: url, timeoutMs: REQUEST_TIMEOUT_MS });
}

/** Pull products + pagination.totalPages out of a GraphQL response. */
function extract(json: any, pool: Cand[], seen: Set<string>, categoryPath: string): { added: number; totalPages: number } {
  let added = 0;
  let totalPages = 1;
  (function walk(o: any, d: number) {
    if (!o || typeof o !== "object" || d > 12) return;
    if (o.pagination && typeof o.pagination.totalPages === "number") totalPages = o.pagination.totalPages;
    if (Array.isArray(o)) { for (const x of o) walk(x, d + 1); return; }
    if (o.name && o.code && o.price && typeof o.price === "object" && typeof o.price.value === "number") {
      const code = String(o.code);
      if (!seen.has(code)) {
        seen.add(code);
        const abs = o.url ? (String(o.url).startsWith("http") ? o.url : BASE + o.url) : BASE;
        // SOLD BY WEIGHT? Mega Image publishes its own per-kilo price beside an approximate
        // pack weight ("+/- 0.700 Kg"), and `price.value` is only the approximate TILL price
        // for a typical piece. Read at the site that knows the payload; see
        // lib/price/variable-weight.ts for why the three facts stay apart.
        const variableWeight = readVariableWeight(o.price);
        pool.push({ name: o.name, brand: o.manufacturerName || "", sourceId: code, price: o.price.value, available: o.available !== false, url: abs, productUrl: o.url ? abs : null, rawPriceText: String(o.price.value), rawSourceBlob: JSON.stringify(o).slice(0, 4096), image: firstImage(o.images), categoryPath, variableWeight });
        added++;
      }
    }
    for (const k of Object.keys(o)) walk(o[k], d + 1);
  })(json, 0);
  return { added, totalPages };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ userAgent: UA, locale: "ro-RO", viewport: { width: 1366, height: 900 }, extraHTTPHeaders: { "accept-language": "ro-RO,ro;q=0.9" } });
  const page = await ctx.newPage();

  // Navigate once so Akamai (_abck/bm_sz) and the store-selection cookie are set; then
  // all category API calls made in-page inherit that session.
  await page.goto(`${BASE}/${CATS[0].path}/c/${CATS[0].code}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(6000);

  const pool: Cand[] = [];
  const seen = new Set<string>();
  for (const c of CATS) {
    let totalPages = 1;
    let catAdded = 0;
    for (let pn = 0; pn < MAX_PAGES; pn++) {
      const json = await fetchPage(page, c.code, pn);
      if (!json || json.__err) { if (pn === 0) console.log(`  ${c.path.padEnd(38)} err ${json?.__err}`); break; }
      const { added, totalPages: tp } = extract(json, pool, seen, c.path);
      totalPages = tp;
      catAdded += added;
      if (pn + 1 >= totalPages) break;
      await sleep(300);
    }
    console.log(`  ${c.path.padEnd(38)} +${catAdded} (pool ${pool.length}, ${totalPages}p)`);
    await sleep(300);
  }
  await browser.close();
  console.log(`Pooled ${pool.length} Mega Image products.`);

  // POOL_ONLY lives in `matchPoolToCatalog` now, so every merchant has it and none can be
  // left out. The bespoke copy that stood here was a second definition of the same thing.

  const merchant = await prisma.merchant.upsert({
    where: { slug: "mega-image" },
    update: { active: true, name: "Mega Image", websiteUrl: BASE, color: "#e2001a" },
    create: { slug: "mega-image", name: "Mega Image", websiteUrl: BASE, color: "#e2001a" },
  });
  // Unmapped. The map that stood here listed the fields by hand, which is exactly how
  // productUrl and rawPriceText went missing the first time — the pool had them.
  // ── addNew ON (2026-09-07). Match-only discarded 5,830 of 7,233 pooled products a night.
  //
  // Projected before turning it on: +5,809 products, single-shop share 89.3% → 91.9%, 21 new
  // duplicate groups. Both inside the brief's limits (93% and 200). Measured after, not
  // assumed — `npm run measure:comparability` logs every step to logs/comparability.jsonl.
  //
  // A product created here is NOT held to a lower bar: every gate — variant block, size,
  // price sanity, provenance — runs exactly as it does for a matched offer. addNew changes
  // where a product comes from, never what it has to pass.
  const r = await matchPoolToCatalog(merchant.id, pool, { label: "mega-image", addNew: true });
  console.log(`\nMega Image: ${r.offers} offers matched (pool ${pool.length}).`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
