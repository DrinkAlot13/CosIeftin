// DCNeu QUANTITY-DISCOUNT tiers. The "buy more = cheaper" tiers (e.g. "3+ 5.30 Lei -15%",
// "6+ 4.99 Lei -20%") are JS-rendered on each product page, so we drive Chromium and read
// them per product. Bounded (MAX) since it's one page-nav per product — run it in batches
// (IMG-style) to cover the catalog over several runs.
//
// Run: npm run scrape:dcneu-tiers   (or DCNEU_TIERS_MAX=300 npm run scrape:dcneu-tiers)

import { chromium, type Page } from "playwright";
import { parsePriceLei } from "../src/lib/price/parsePrice";
import { prisma } from "../src/lib/db";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const MAX = Number(process.env.DCNEU_TIERS_MAX ?? 160);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const dcneu = await prisma.merchant.findFirst({ where: { slug: "dcneu" } });
  if (!dcneu) { console.log("no dcneu merchant"); return; }
  // products without tiers yet (so repeated runs cover more of the catalog)
  const offers = await prisma.offer.findMany({
    where: { merchantId: dcneu.id, bulkTiers: null, url: { contains: "dcneu.ro" } },
    take: MAX,
    orderBy: { id: "asc" },
  });
  console.log(`DCNeu tiers: ${offers.length} products to check.`);

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ userAgent: UA, locale: "ro-RO", viewport: { width: 1366, height: 900 } });
  // Parallelize across a pool of pages — the per-product page-render is the bottleneck.
  const CONCURRENCY = Number(process.env.DCNEU_TIERS_CONCURRENCY ?? 4);
  const pages: Page[] = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    const pg = await ctx.newPage();
    await pg.addInitScript(() => { (globalThis as unknown as { __name: (f: unknown) => unknown }).__name = (f) => f; });
    pages.push(pg);
  }

  let withTiers = 0;
  let next = 0;

  async function processOne(page: Page, o: (typeof offers)[number]) {
    try {
      await page.goto(o.url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(1800);
      const raw = await page.evaluate(() => {
        const seen = new Map<number, number>();
        // Real DCNeu tier rows look like "3+ 5.30 Lei -15%" — REQUIRE the discount %,
        // which distinguishes them from random "N+ price" text elsewhere on the page.
        for (const el of Array.from(document.querySelectorAll("table tr, li, .discount, [class*='discount' i], [class*='pret' i]"))) {
          const t = (el.textContent || "").replace(/\s+/g, " ").trim();
          if (t.length > 44) continue;
          const m = t.match(/^(\d+)\s*\+\s*([\d.]*\d[.,]\d{2})\s*lei\b[^%]{0,12}\d+\s*%/i);
          if (m) {
            const qty = parseInt(m[1], 10);
            const price = parsePriceLei(m[2]) ?? 0;
            if (qty > 1 && qty < 200 && price > 0 && !seen.has(qty)) seen.set(qty, price);
          }
        }
        return [...seen.entries()].map(([qty, price]) => ({ qty, price })).sort((a, b) => a.qty - b.qty);
      });
      // Keep strictly-decreasing tiers that are a PLAUSIBLE bulk discount (real DCNeu tiers
      // are ~5-45% off; steeper values are cross-product noise from sidebar promos).
      const clean: { qty: number; price: number }[] = [];
      let last = o.price;
      for (const t of raw) {
        if (t.price < o.price && t.price >= o.price * 0.55 && t.price < last - 1e-9) { clean.push(t); last = t.price; }
      }
      const full = clean.length ? [{ qty: 1, price: o.price }, ...clean] : []; // [] = checked, no tiers
      await prisma.offer.update({ where: { id: o.id }, data: { bulkTiers: JSON.stringify(full) } });
      if (clean.length) withTiers++;
    } catch {
      /* skip */
    }
  }

  async function worker(page: Page) {
    while (true) {
      const i = next++;
      if (i >= offers.length) break;
      await processOne(page, offers[i]);
      await sleep(150);
    }
  }
  await Promise.all(pages.map((pg) => worker(pg)));
  await browser.close();
  console.log(`DCNeu tiers: ${withTiers}/${offers.length} products had quantity discounts (concurrency ${CONCURRENCY}).`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
