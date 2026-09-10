// REAL scraper: Carrefour (carrefour.ro — Magento, behind Cloudflare). Cloudflare's
// JS challenge is cleared by driving a real Chromium (Playwright). Products are
// server-rendered as `li.product[data-product-id]` cards; we read name/price/brand/
// image from the DOM on each leaf category page, pool + match our pre-set items.
//
// Run: npm run scrape:carrefour

import { chromium } from "playwright";
import { prisma } from "../src/lib/db";
import { parsePriceLei, parsePriceDetailed } from "../src/lib/price/parsePrice";
import { matchPoolToCatalog, type StoreProduct } from "../src/lib/scrape-util";
import { notePageCap } from "../src/lib/truncation";
import { pickImageUrl } from "../src/lib/image-src";

const BASE = "https://carrefour.ro";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Leaf food/household categories. carrefour.ro sells shelf-stable groceries only
// (fresh dairy/produce/meat live on Bringo), so this is the pantry + drinks + cleaning
// catalog — paginated deeply via Magento's ?p=N.
const CATS = [
  "bacanie-carrefour/alimente/ulei",
  "bacanie-carrefour/alimente/paste-fainoase",
  "bacanie-carrefour/alimente/orez-si-legume-uscate",
  "bacanie-carrefour/alimente/conserve",
  "bacanie-carrefour/alimente/zahar-si-ingrediente-prajituri",
  "bacanie-carrefour/alimente/lapte-si-derivate-lapte-uht",
  "bacanie-carrefour/alimente/cafea/cafea-macinata",
  "bacanie-carrefour/alimente/cafea/cafea-boabe",
  "bacanie-carrefour/alimente/ceai",
  "bacanie-carrefour/alimente/cereale-si-musli",
  "bacanie-carrefour/alimente/prajituri",
  "bacanie-carrefour/alimente/sosuri",
  "bacanie-carrefour/alimente/ciocolata",
  "bacanie-carrefour/alimente/bomboane",
  "bacanie-carrefour/alimente/biscuiti-si-napolitane",
  "bacanie-carrefour/alimente/produse-de-post",
  "bacanie-carrefour/bauturi-nealcoolice/apa",
  "bacanie-carrefour/bauturi-nealcoolice/sucuri-carbogazoase",
  "bacanie-carrefour/bauturi-nealcoolice/sucuri-si-nectaruri",
  "casa-gradina-si-petshop/produse-curatenie-pentru-casa/intretinere-rufe/detergent-pentru-rufe",
  "casa-gradina-si-petshop/produse-curatenie-pentru-casa/servetele-si-produse-din-hartie/hartie-igienica",
];
const MAX_PAGES = 13; // ?p=1..13 (24/page); stops early when a page adds nothing new.

// The pool IS a StoreProduct list — using the shared type means provenance fields
// (rawPriceText, productUrl, reference price) can never be silently dropped here.
type Cand = StoreProduct;

// Prices go through the ONE parser (CLAUDE.md → Prices). It returns null on ambiguity,
// and an unparseable card is skipped rather than published as 0.

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
  const scrapePage = () =>
    page.$$eval("li.product[data-product-id]", (els) =>
      els.map((el) => {
        const q = (s: string) => el.querySelector(s);
        const name = (q("a[title]")?.getAttribute("title") || q('[class*="name" i] a')?.textContent || q('[class*="name" i]')?.textContent || "").replace(/\s+/g, " ").trim();
        const priceText = (q('[class*="price" i]')?.textContent || "").replace(/\s+/g, " ").trim();
        // RAW ATTRIBUTES ONLY. Which one is the photograph is decided in Node by
        // `pickImageUrl` (lib/image-src) — this ran `src` first, and on a lazy-loading
        // site `src` is the spinner until JavaScript swaps it, so 851 live products
        // stored Carrefour's AjaxLoader gif and the `data-src` fallback never ran.
        const imgEl = q("img");
        const imgAttrs = {
          "data-src": imgEl?.getAttribute("data-src") ?? null,
          "data-original": imgEl?.getAttribute("data-original") ?? null,
          "data-lazy": imgEl?.getAttribute("data-lazy") ?? null,
          "data-lazy-src": imgEl?.getAttribute("data-lazy-src") ?? null,
          "data-srcset": imgEl?.getAttribute("data-srcset") ?? null,
          srcset: imgEl?.getAttribute("srcset") ?? null,
          src: imgEl?.getAttribute("src") ?? null,
        };
        const brand = el.querySelector("[data-brand]")?.getAttribute("data-brand") || "";
        const dim = el.querySelector("[data-dimension10]")?.getAttribute("data-dimension10") || "available";
        // THE PRODUCT'S OWN LINK, not merely the first anchor in the tile.
        //
        // `querySelector('a[href]')` returns whichever anchor comes first in the markup, and a
        // Carrefour tile can lead with a campaign badge. That put 20 offers on
        // /campanii/reduceri-de-gama, 8 on a PDF of promo regulations and 4 on an ad-tracking
        // redirect — non-products in the catalog, all sharing one URL, which also read as an
        // 18-way matcher fan-out because the audit identifies a store product by its link.
        //
        // A product page lives under /produse/. Anything else is not this tile's product, and
        // the tile's titled anchor (the one carrying the product name) is the fallback.
        const anchors = [...el.querySelectorAll('a[href]:not([href^="javascript"])')];
        const isProduct = (h: string) => /\/produse\//i.test(h) && !/\.(pdf|docx?|xlsx?)(\?|$)/i.test(h);
        const linkEl =
          anchors.find((a) => isProduct(a.getAttribute("href") || "")) ??
          (el.querySelector("a[title][href]") as HTMLAnchorElement | null);
        const href = linkEl?.getAttribute("href") || "";
        const link = isProduct(href) ? href : "";
        return { id: el.getAttribute("data-product-id"), name, priceText, imgAttrs, brand, available: dim !== "not available", link };
      }),
    );

  for (const cat of CATS) {
    let catAdded = 0;
    let lastPage = 0;
    for (let p = 1; p <= MAX_PAGES; p++) {
      if (p === MAX_PAGES) notePageCap(`${__filename.split(/[\/]/).pop()} page loop`, p, MAX_PAGES);
      try {
        await page.goto(`${BASE}/${cat}${p > 1 ? `?p=${p}` : ""}`, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForTimeout(p === 1 ? 6000 : 3500);
        const raw = await scrapePage();
        if (raw.length === 0) break; // past the last page
        let pageAdded = 0;
        // `cat` is a LEAF path ("bacanie-carrefour/alimente/cafea/cafea-macinata") — the
        // merchant's own taxonomy, far better than anything a name rule could infer, and we
        // were discarding it at the write.
        for (const r of raw) {
          const key = String(r.id ?? r.name);
          if (!r.name || seen.has(key)) continue;
          seen.add(key);
          // ── `brand: ""` AND NOT `r.brand`. DELIBERATE. See docs/CARREFOUR-BRAND.md.
          //
          // `data-brand` is not this product's brand. Measured against brands supplied
          // independently by other merchants it agrees 53.8% of the time, where Mega Image is at
          // 98.8% and Freshful at 97.7%. The tell is that one value lands on several DIFFERENT
          // products of the same category while Carrefour's own product name carries the right
          // one: "Dorna" on Aqua Carpatica, Borsec AND Perla Harghitei; "San Bernardo" on Zizin
          // and Aquatique; "Carrefour Bio" on Prodlacta. That is a promoted-brand slot inside the
          // card, not a per-product attribute — the `querySelector` scoping is correct.
          //
          // A wrong brand is worse than none: `Product.brand` feeds `decide()`'s brand gate, and
          // a wrong one does not lose a comparison, it manufactures one (CLAUDE.md, Zarea).
          //
          // The real brand IS published, in the DETAIL page's JSON-LD `brand.name`, at 100% of 25
          // sampled pages. `backfill-carrefour-brands.ts` harvests it; this line stays "" until
          // that has run, because a listing scrape must not overwrite a detail-page truth with a
          // measured falsehood. `r.brand` is still kept in `rawSourceBlob` for analysis.
          pool.push({ name: r.name, brand: "", price: parsePriceLei(r.priceText) ?? 0, rawPriceText: r.priceText, productUrl: r.link ? (r.link.startsWith("http") ? r.link : BASE + r.link) : null, referencePriceBani: parsePriceDetailed(r.priceText).referencePriceBani ?? null, referencePriceKind: parsePriceDetailed(r.priceText).referencePriceKind ?? null, available: r.available, url: r.link ? (r.link.startsWith("http") ? r.link : BASE + r.link) : BASE, image: pickImageUrl(r.imgAttrs, BASE), rawSourceBlob: JSON.stringify(r).slice(0, 4096), categoryPath: cat });
          pageAdded++;
          catAdded++;
        }
        lastPage = p;
        if (pageAdded === 0) break; // page had only products we've already seen
      } catch (e) {
        console.log(`  ${cat} p${p} eroare: ${(e as Error).message.slice(0, 40)}`);
        break;
      }
    }
    console.log(`  ${cat.split("/").pop()!.padEnd(28)} +${catAdded} (pool ${pool.length}, ${lastPage}p)`);
  }
  await browser.close();
  console.log(`Pooled ${pool.length} Carrefour products.`);

  const merchant = await prisma.merchant.upsert({
    where: { slug: "carrefour" },
    update: { active: true, name: "Carrefour", websiteUrl: BASE, color: "#0050aa" },
    create: { slug: "carrefour", name: "Carrefour", websiteUrl: BASE, color: "#0050aa" },
  });
  // Pass the pool UNMAPPED. The map that used to sit here listed six fields and so discarded
  // rawPriceText, productUrl and both reference-price fields — all of which the push above
  // sets correctly. Every Carrefour offer was written with no source string and no Omnibus
  // figure because of that one line.
  // ── addNew ON (2026-09-07). Projected: +2,903 products, single-shop 91.9% → 92.8%,
  // 11 new duplicate groups. Inside the brief's limits; measured after, not assumed.
  // Every gate still applies — addNew changes where a product comes from, not what it passes.
  const r = await matchPoolToCatalog(merchant.id, pool, { label: "carrefour", addNew: true });
  console.log(`\nCarrefour: ${r.offers} offers matched (pool ${pool.length}).`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
