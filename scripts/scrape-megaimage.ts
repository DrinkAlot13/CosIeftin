// REAL scraper: Mega Image (mega-image.ro — SAP Hybris + Apollo GraphQL, behind
// Akamai bot manager and store-gated). Plain fetch won't work (needs a real browser
// session + a selected store), so we drive a real Chromium (Playwright): navigate
// each category page, INTERCEPT the GetCategoryProductSearch GraphQL responses the
// page itself fetches, scroll to load more, pool + match our pre-set items.
//
// Run: npm run scrape:megaimage   (Playwright + Chromium must be installed)

import { chromium } from "playwright";
import { ITEMS, type ItemDef } from "../src/data/catalog";
import { prisma } from "../src/lib/db";
import { parseSize } from "../src/lib/ingest-core";
import { normalizeText } from "../src/lib/matching";

const BASE = "https://www.mega-image.ro";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

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

type Cand = { name: string; brand: string; code: string; price: number; available: boolean; url: string; image: string | null };

function firstImage(images: unknown): string | null {
  if (!Array.isArray(images)) return null;
  const primary = images.filter((i) => i.imageType === "PRIMARY");
  const pick = primary.find((i) => i.format === "small") || primary.find((i) => i.format === "respListGrid") || primary[0] || images[0];
  if (!pick?.url) return null;
  return pick.url.startsWith("http") ? pick.url : BASE + pick.url;
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
  const ctx = await browser.newContext({ userAgent: UA, locale: "ro-RO", viewport: { width: 1366, height: 900 }, extraHTTPHeaders: { "accept-language": "ro-RO,ro;q=0.9" } });
  const page = await ctx.newPage();

  const pool: Cand[] = [];
  const seen = new Set<string>();
  page.on("response", async (r) => {
    if (!r.url().includes("GetCategoryProductSearch")) return;
    let j: unknown;
    try { j = await r.json(); } catch { return; }
    (function walk(o: any, d: number) {
      if (!o || typeof o !== "object" || d > 12) return;
      if (Array.isArray(o)) { for (const x of o) walk(x, d + 1); return; }
      if (o.name && o.code && o.price && typeof o.price === "object" && typeof o.price.value === "number") {
        const code = String(o.code);
        if (!seen.has(code)) {
          seen.add(code);
          pool.push({ name: o.name, brand: o.manufacturerName || "", code, price: o.price.value, available: o.available !== false, url: o.url ? (String(o.url).startsWith("http") ? o.url : BASE + o.url) : BASE, image: firstImage(o.images) });
        }
      }
      for (const k of Object.keys(o)) walk(o[k], d + 1);
    })(j, 0);
  });

  for (const c of CATS) {
    try {
      await page.goto(`${BASE}/${c.path}/c/${c.code}`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(6000);
      for (let s = 0; s < 3; s++) { await page.mouse.wheel(0, 5000); await page.waitForTimeout(2500); }
      console.log(`  ${c.path.padEnd(38)} pool ${pool.length}`);
    } catch (e) {
      console.log(`  ${c.path.padEnd(38)} eroare: ${(e as Error).message.slice(0, 60)}`);
    }
  }
  await browser.close();
  console.log(`Pooled ${pool.length} Mega Image products.`);

  const merchant = await prisma.merchant.upsert({
    where: { slug: "mega-image" },
    update: { active: true, name: "Mega Image", websiteUrl: BASE, color: "#e2001a" },
    create: { slug: "mega-image", name: "Mega Image", websiteUrl: BASE, color: "#e2001a" },
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
  console.log(`\nMega Image: ${matched}/${ITEMS.length} produse cu preț real ingerate.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
