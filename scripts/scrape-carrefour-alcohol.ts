// REAL scraper: Carrefour ALCOHOL → the "alcohol" section. Reuses the proven Carrefour
// Playwright approach (beats Cloudflare; products are `li.product[data-product-id]` cards)
// but on the wine/spirits categories, so alcohol finally has cross-store comparison
// (Carrefour vs FineStore vs Le Manoir).
//
// Run: npm run scrape:carrefour-alcohol

import { chromium } from "playwright";
import { prisma } from "../src/lib/db";
import { parsePriceLei, parsePriceDetailed } from "../src/lib/price/parsePrice";
import { matchPoolToCatalog, type StoreProduct } from "../src/lib/scrape-util";
import { notePageCap } from "../src/lib/truncation";

const BASE = "https://carrefour.ro";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const MAX_PAGES = 8;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CATS: { path: string; cat: string }[] = [
  { path: "bacanie-carrefour/vinuri-romanesti-si-internationale/vinuri-albe", cat: "vin" },
  { path: "bacanie-carrefour/vinuri-romanesti-si-internationale/vinuri-rosii", cat: "vin" },
  { path: "bacanie-carrefour/vinuri-romanesti-si-internationale/vinuri-rose", cat: "vin" },
  { path: "bacanie-carrefour/vinuri-romanesti-si-internationale/vinuri-spumante", cat: "sampanie" },
  { path: "bacanie-carrefour/bauturi-alcoolice/whisky", cat: "whisky" },
  { path: "bacanie-carrefour/bauturi-alcoolice/vodka", cat: "spirtoase" },
  { path: "bacanie-carrefour/bauturi-alcoolice/gin", cat: "spirtoase" },
  { path: "bacanie-carrefour/bauturi-alcoolice/rom", cat: "spirtoase" },
  { path: "bacanie-carrefour/bauturi-alcoolice/tequila", cat: "spirtoase" },
  { path: "bacanie-carrefour/bauturi-alcoolice/cognac", cat: "spirtoase" },
  { path: "bacanie-carrefour/bauturi-alcoolice/lichior-si-crema-de-whisky", cat: "lichior" },
];

// Prices go through the ONE parser (CLAUDE.md → Prices).
function normVol(name: string): string {
  return name.replace(/(\d+(?:[.,]\d+)?)\s*cl\b/gi, (_m, n) => `${Math.round(parseFloat(String(n).replace(",", ".")) * 10)} ml`);
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ userAgent: UA, locale: "ro-RO", viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => { (globalThis as unknown as { __name: (f: unknown) => unknown }).__name = (f) => f; });

  const scrapePage = () =>
    page.$$eval("li.product[data-product-id]", (els) =>
      els.map((el) => {
        const q = (s: string) => el.querySelector(s);
        const name = (q("a[title]")?.getAttribute("title") || q('[class*="name" i] a')?.textContent || q('[class*="name" i]')?.textContent || "").replace(/\s+/g, " ").trim();
        const priceText = (q('[class*="price" i]')?.textContent || "").replace(/\s+/g, " ").trim();
        const img = (q("img")?.getAttribute("src") || q("img")?.getAttribute("data-src") || "").trim();
        const brand = el.querySelector("[data-brand]")?.getAttribute("data-brand") || "";
        const dim = el.querySelector("[data-dimension10]")?.getAttribute("data-dimension10") || "available";
        const link = el.querySelector('a[href]:not([href^="javascript"])')?.getAttribute("href") || "";
        return { id: el.getAttribute("data-product-id"), name, priceText, img, brand, available: dim !== "not available", link };
      }),
    );

  const pool: StoreProduct[] = [];
  const seen = new Set<string>();
  for (const c of CATS) {
    let catAdded = 0;
    for (let p = 1; p <= MAX_PAGES; p++) {
      if (p === MAX_PAGES) notePageCap(`${__filename.split(/[\/]/).pop()} page loop`, p, MAX_PAGES);
      try {
        await page.goto(`${BASE}/${c.path}${p > 1 ? `?p=${p}` : ""}`, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForTimeout(p === 1 ? 6000 : 3500);
        const raw = await scrapePage();
        if (raw.length === 0) break;
        let pageAdded = 0;
        for (const r of raw) {
          const key = String(r.id ?? r.name);
          if (!r.name || seen.has(key)) continue;
          seen.add(key);
          pool.push({ name: normVol(r.name), brand: r.brand, price: parsePriceLei(r.priceText) ?? 0, rawPriceText: r.priceText, productUrl: r.link ? (r.link.startsWith("http") ? r.link : BASE + r.link) : BASE, referencePriceBani: parsePriceDetailed(r.priceText).referencePriceBani ?? null, referencePriceKind: parsePriceDetailed(r.priceText).referencePriceKind ?? null, available: r.available, url: r.link ? (r.link.startsWith("http") ? r.link : BASE + r.link) : BASE, image: r.img ? (r.img.startsWith("http") ? r.img : BASE + r.img) : null, category: c.cat, rawSourceBlob: JSON.stringify(r).slice(0, 4096) });
          pageAdded++;
          catAdded++;
        }
        if (pageAdded === 0) break;
      } catch (e) {
        console.log(`  ${c.path} p${p} eroare: ${(e as Error).message.slice(0, 40)}`);
        break;
      }
    }
    console.log(`  ${c.path.split("/").pop()!.padEnd(24)} +${catAdded} (pool ${pool.length})`);
    await sleep(1500);
  }
  await browser.close();
  console.log(`Pooled ${pool.length} Carrefour alcohol products.`);

  const merchant = await prisma.merchant.upsert({
    where: { slug: "carrefour" },
    update: { active: true, name: "Carrefour", websiteUrl: BASE, color: "#0050aa" },
    create: { slug: "carrefour", name: "Carrefour", websiteUrl: BASE, color: "#0050aa" },
  });
  const r = await matchPoolToCatalog(merchant.id, pool, { section: "alcohol", addNew: true, label: "carrefour-alcohol" });
  console.log(`\nCarrefour alcohol: ${r.offers} offers (${r.created} new) from pool ${pool.length}.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
