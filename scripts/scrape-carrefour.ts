// REAL scraper: Carrefour (carrefour.ro — Magento, behind Cloudflare). Cloudflare's
// JS challenge is cleared by driving a real Chromium (Playwright). Products are
// server-rendered as `li.product[data-product-id]` cards; we read name/price/brand/
// image from the DOM on each leaf category page, pool + match our pre-set items.
//
// Run: npm run scrape:carrefour

import { chromium } from "playwright";
import { ITEMS, type ItemDef } from "../src/data/catalog";
import { prisma } from "../src/lib/db";
import { parseSize } from "../src/lib/ingest-core";
import { normalizeText } from "../src/lib/matching";

const BASE = "https://carrefour.ro";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Leaf food/household categories covering our pre-set items.
const CATS = [
  "bacanie-carrefour/alimente/ulei",
  "bacanie-carrefour/alimente/paste-fainoase",
  "bacanie-carrefour/alimente/orez-si-legume-uscate",
  "bacanie-carrefour/alimente/conserve",
  "bacanie-carrefour/alimente/zahar-si-ingrediente-prajituri",
  "bacanie-carrefour/alimente/lapte-si-derivate-lapte-uht",
  "bacanie-carrefour/alimente/cafea/cafea-macinata",
  "bacanie-carrefour/alimente/ceai",
  "bacanie-carrefour/alimente/cereale-si-musli",
  "bacanie-carrefour/bauturi-nealcoolice/apa",
  "bacanie-carrefour/bauturi-nealcoolice/sucuri-carbogazoase",
  "bacanie-carrefour/bauturi-nealcoolice/sucuri-si-nectaruri",
  "casa-gradina-si-petshop/produse-curatenie-pentru-casa/intretinere-rufe/detergent-pentru-rufe",
  "casa-gradina-si-petshop/produse-curatenie-pentru-casa/servetele-si-produse-din-hartie/hartie-igienica",
];

type Cand = { name: string; brand: string; price: number; available: boolean; url: string; image: string | null };

function parsePrice(text: string): number {
  const ms = [...text.matchAll(/(\d+)\s+(\d{2})\s*lei/gi)].map((m) => parseFloat(`${m[1]}.${m[2]}`));
  if (ms.length) return Math.min(...ms);
  const m2 = text.match(/(\d+)[.,](\d{2})/);
  return m2 ? parseFloat(`${m2[1]}.${m2[2]}`) : 0;
}

function pickBest(item: ItemDef, cands: Cand[]): Cand | null {
  const head = normalizeText(item.name).split(" ")[0];
  const sizeOk = cands.filter((c) => {
    if (normalizeText(c.name).split(" ")[0] !== head) return false;
    const s = parseSize(c.name);
    return s && s.unit === item.unit && Math.abs(s.unitSize - item.unitSize) <= item.unitSize * 0.06 + 1e-9;
  });
  let pool = sizeOk;
  if (item.brand) {
    const nb = normalizeText(item.brand);
    const branded = pool.filter((c) => normalizeText(c.brand).includes(nb) || normalizeText(c.name).includes(nb));
    if (branded.length === 0) return null;
    pool = branded;
  }
  const priced = pool.filter((c) => c.price > 0);
  if (priced.length === 0) return null;
  const avail = priced.filter((c) => c.available);
  const finalPool = avail.length > 0 ? avail : priced;
  return finalPool.reduce((a, b) => (b.price < a.price ? b : a));
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ userAgent: UA, locale: "ro-RO", viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  // tsx/esbuild wraps functions with a `__name` helper; shim it in the page so
  // serialized $$eval callbacks don't throw "__name is not defined".
  await page.addInitScript(() => {
    (globalThis as unknown as { __name: (f: unknown) => unknown }).__name = (f) => f;
  });

  const pool: Cand[] = [];
  const seen = new Set<string>();
  for (const cat of CATS) {
    try {
      await page.goto(`${BASE}/${cat}`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(6000);
      const raw = await page.$$eval("li.product[data-product-id]", (els) =>
        els.map((el) => {
          const q = (s: string) => el.querySelector(s);
          const name = (q("a[title]")?.getAttribute("title") || q('[class*="name" i] a')?.textContent || q('[class*="name" i]')?.textContent || "").replace(/\s+/g, " ").trim();
          const priceText = (q('[class*="price" i]')?.textContent || "").replace(/\s+/g, " ").trim();
          const img = (q("img")?.getAttribute("src") || q("img")?.getAttribute("data-src") || "").trim();
          const brand = el.querySelector("[data-brand]")?.getAttribute("data-brand") || "";
          const dim = el.querySelector("[data-dimension10]")?.getAttribute("data-dimension10") || "available";
          const linkEl = el.querySelector('a[href]:not([href^="javascript"])');
          const link = linkEl?.getAttribute("href") || "";
          return { id: el.getAttribute("data-product-id"), name, priceText, img, brand, available: dim !== "not available", link };
        }),
      );
      let added = 0;
      for (const r of raw) {
        const key = String(r.id ?? r.name);
        if (!r.name || seen.has(key)) continue;
        seen.add(key);
        pool.push({ name: r.name, brand: r.brand, price: parsePrice(r.priceText), available: r.available, url: r.link ? (r.link.startsWith("http") ? r.link : BASE + r.link) : BASE, image: r.img ? (r.img.startsWith("http") ? r.img : BASE + r.img) : null });
        added++;
      }
      console.log(`  ${cat.split("/").pop()!.padEnd(28)} +${added} (pool ${pool.length})`);
    } catch (e) {
      console.log(`  ${cat} eroare: ${(e as Error).message.slice(0, 50)}`);
    }
  }
  await browser.close();
  console.log(`Pooled ${pool.length} Carrefour products.`);

  const merchant = await prisma.merchant.upsert({
    where: { slug: "carrefour" },
    update: { active: true, name: "Carrefour", websiteUrl: BASE, color: "#0050aa" },
    create: { slug: "carrefour", name: "Carrefour", websiteUrl: BASE, color: "#0050aa" },
  });
  await prisma.priceHistory.deleteMany({ where: { offer: { merchantId: merchant.id } } });
  await prisma.offer.deleteMany({ where: { merchantId: merchant.id } });

  let matched = 0;
  for (const item of ITEMS) {
    const best = pickBest(item, pool);
    if (!best) { console.log(`  · ${item.name.padEnd(34)} -> fără potrivire`); continue; }
    const product = await prisma.product.findUnique({ where: { slug: item.slug } });
    if (!product) continue;
    if (best.image && !product.image) await prisma.product.update({ where: { id: product.id }, data: { image: best.image } }).catch(() => {});
    const ppu = item.unitSize > 0 ? best.price / item.unitSize : best.price;
    const offer = await prisma.offer.create({
      data: { productId: product.id, merchantId: merchant.id, price: best.price, pricePerUnit: ppu, packLabel: item.packLabel, availability: best.available ? "in stock" : "out of stock", url: best.url, currency: "RON", matchedBy: "scraper" },
    });
    await prisma.priceHistory.create({ data: { offerId: offer.id, price: best.price } });
    matched++;
    console.log(`  ✓ ${item.name.padEnd(34)} -> ${best.price} lei  (${best.name})`);
  }
  console.log(`\nCarrefour: ${matched}/${ITEMS.length} produse cu preț real ingerate.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
