// REAL scraper: FineStore (finestore.ro) — Romania's big online spirits/wine shop,
// Magento behind Cloudflare, so we drive Chromium (Playwright). Custom theme: product
// cards are `.fshr_inner`, price/sku live on `.hmmcf_addtocart[data-price]`, and the
// product link/image are on the card. Paginated with ?p=N. Feeds the "alcohol" section.
//
// Run: npm run scrape:finestore

import { chromium } from "playwright";
import { parsePriceLei } from "../src/lib/price/parsePrice";
import { prisma } from "../src/lib/db";
import { matchPoolToCatalog, type StoreProduct } from "../src/lib/scrape-util";
import { notePageCap } from "../src/lib/truncation";

const BASE = "https://www.finestore.ro";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const MAX_PAGES = 12;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CATS = [
  { path: "whisky", cat: "whisky" },
  { path: "vin-rosu", cat: "vin" },
  { path: "vin-alb", cat: "vin" },
  { path: "vin-rose", cat: "vin" },
  { path: "gin", cat: "spirtoase" },
  { path: "vodka", cat: "spirtoase" },
  { path: "rom", cat: "spirtoase" },
  { path: "tequila", cat: "spirtoase" },
  { path: "coniac", cat: "spirtoase" },
  { path: "brandy", cat: "spirtoase" },
  { path: "vermut-aperitiv", cat: "spirtoase" },
  { path: "traditionale-palinca", cat: "spirtoase" },
  { path: "traditionale-rachiu", cat: "spirtoase" },
  { path: "traditionale-tuica", cat: "spirtoase" },
  { path: "lichior", cat: "lichior" },
  { path: "sampanie", cat: "sampanie" },
  { path: "prosecco", cat: "sampanie" },
  { path: "vin-spumant", cat: "sampanie" },
];

/** "75cl" -> "750 ml" so parseSize can read the volume for cross-store matching. */
function normVol(name: string): string {
  return name.replace(/(\d+(?:[.,]\d+)?)\s*cl\b/gi, (_m, n) => `${Math.round(parseFloat(String(n).replace(",", ".")) * 10)} ml`);
}

/** Derive a readable name from the product URL slug when the card has no title text. */
function nameFromHref(href: string): string {
  const seg = (href.split("/").pop() || "").replace(/\.html.*$/, "");
  return seg.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ userAgent: UA, locale: "ro-RO", viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => { (globalThis as unknown as { __name: (f: unknown) => unknown }).__name = (f) => f; });

  const pool: StoreProduct[] = [];
  const seen = new Set<string>();
  for (const c of CATS) {
    let catAdded = 0;
    for (let p = 1; p <= MAX_PAGES; p++) {
      if (p === MAX_PAGES) notePageCap(`${__filename.split(/[\/]/).pop()} page loop`, p, MAX_PAGES);
      let raw: { priceText: string; sku: string; name: string; href: string; img: string }[] = [];
      const grab = () =>
        page.$$eval(".fshr_inner", (nodes) =>
          nodes.map((card) => {
            const cart = card.querySelector(".hmmcf_addtocart[data-price]");
            // Return the RAW attribute and parse it in Node through the one true parser.
            // Parsing here would mean a second implementation living in the browser context,
            // which is exactly how this store shipped a 2-lei Dom Pérignon (data-price is
            // US-format, "2,033.39", and a naive parseFloat stops at the comma).
            const priceText = cart?.getAttribute("data-price") || "";
            const sku = cart?.getAttribute("data-sku") || "";
            const links = [...card.querySelectorAll('a[href*=".html"]')];
            let name = "";
            let href = "";
            for (const l of links) {
              const t = (l.getAttribute("title") || l.textContent || "").replace(/\s+/g, " ").trim();
              if (t.length > name.length) name = t;
              if (!href) href = l.getAttribute("href") || "";
            }
            const img = card.querySelector("img")?.getAttribute("src") || card.querySelector("img")?.getAttribute("data-src") || "";
            return { priceText, sku, name, href, img };
          }),
        );
      try {
        await page.goto(`${BASE}/${c.path}${p > 1 ? `?p=${p}` : ""}`, { waitUntil: "domcontentloaded", timeout: 45000 });
        // Wait until product cards actually render (Cloudflare re-render / hydration can
        // be slow and varies per page) rather than a fixed sleep.
        const appeared = await page.waitForSelector(".fshr_inner .hmmcf_addtocart[data-price]", { timeout: 18000 }).then(() => true).catch(() => false);
        await page.waitForTimeout(appeared ? 800 : 3000);
        raw = await grab();
      } catch (e) {
        console.log(`  ${c.path} p${p} eroare: ${(e as Error).message.slice(0, 40)}`);
        break;
      }
      if (raw.length === 0) break;
      let pageAdded = 0;
      for (const r of raw) {
        const key = r.sku || r.href || r.name;
        // null = ambiguous; skip rather than publish a wrong or zero price
        const price = parsePriceLei(r.priceText);
        if (!key || seen.has(key) || price == null) continue;
        seen.add(key);
        const name = normVol(r.name || nameFromHref(r.href));
        if (!name) continue;
        pool.push({
          name,
          brand: "",
          price,
          rawPriceText: r.priceText,
          productUrl: r.href ? (r.href.startsWith("http") ? r.href : `${BASE}/${r.href.replace(/^\//, "")}`) : null,
          available: true,
          url: r.href ? (r.href.startsWith("http") ? r.href : `${BASE}/${r.href.replace(/^\//, "")}`) : BASE,
          image: r.img ? (r.img.startsWith("http") ? r.img : `${BASE}/${r.img.replace(/^\//, "")}`) : null,
          category: c.cat,
          // KEEP THE SOURCE PAYLOAD. This is a DOM source, so there is no JSON record — the
          // extracted card fields are the closest honest equivalent, and something is better
          // than the zero we had. Without it `audit:unit-oracle` cannot check this merchant
          // at all, and ten of twelve were in that state.
          rawSourceBlob: JSON.stringify(r).slice(0, 4096), categoryPath: c.path });
        pageAdded++;
        catAdded++;
      }
      if (pageAdded === 0) break;
    }
    console.log(`  ${c.path.padEnd(24)} +${catAdded} (pool ${pool.length})`);
    await sleep(2500); // pace between categories so Cloudflare doesn't challenge heavy (wine) pages
  }
  await browser.close();
  console.log(`Pooled ${pool.length} FineStore products.`);

  const merchant = await prisma.merchant.upsert({
    where: { slug: "finestore" },
    update: { active: true, name: "FineStore", websiteUrl: BASE, color: "#111111" },
    create: { slug: "finestore", name: "FineStore", websiteUrl: BASE, color: "#111111" },
  });
  const r = await matchPoolToCatalog(merchant.id, pool, { section: "alcohol", addNew: true, label: "finestore" });
  console.log(`\nFineStore: ${r.offers} offers (${r.created} new alcohol products) from pool ${pool.length}.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
