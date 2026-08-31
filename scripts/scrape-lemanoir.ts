// REAL scraper: Le Manoir (lemanoir.ro) — wine & champagne merchant, standard
// Magento, no Cloudflare, so a plain fetch of each category page works. Products are
// `.product-item` cards with `.product-item-link` (name+url), `data-price-amount`,
// and `data-product-id`. Paginated with Magento's ?p=N. Feeds the "alcohol" section.
//
// Run: npm run scrape:lemanoir

import { parsePriceLei } from "../src/lib/price/parsePrice";
import { prisma } from "../src/lib/db";
import { matchPoolToCatalog, type StoreProduct } from "../src/lib/scrape-util";

const BASE = "https://lemanoir.ro";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MAX_PAGES = 15;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CATS = [
  { path: "vinuri/rosii.html", cat: "vin" },
  { path: "vinuri/albe.html", cat: "vin" },
  { path: "vinuri/rose.html", cat: "vin" },
  { path: "vinuri/dulci.html", cat: "vin" },
  { path: "vinuri/ampanii-vinuri-spumante.html", cat: "sampanie" },
  { path: "vinuri/vinuri-de-porto.html", cat: "vin" },
  { path: "spirtoase.html", cat: "spirtoase" },
  { path: "spirtoase/whisky.html", cat: "whisky" },
  { path: "spirtoase/cognac.html", cat: "spirtoase" },
];

/** Turn "75cl"/"70 cl" into millilitres so parseSize can read the volume. */
function normVol(name: string): string {
  return name.replace(/(\d+(?:[.,]\d+)?)\s*cl\b/gi, (_m, n) => `${Math.round(parseFloat(String(n).replace(",", ".")) * 10)} ml`);
}

function parseProducts(html: string, cat: string): StoreProduct[] {
  const out: StoreProduct[] = [];
  const blocks = html.split(/class="[^"]*product-item-info[^"]*"/i).slice(1);
  for (const b of blocks) {
    const a = b.match(/class="product-item-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i) || b.match(/href="([^"]+)"[^>]*class="product-item-link"[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const url = a[1];
    const name = a[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    const priceM = b.match(/data-price-amount="([\d.]+)"/);
    const price = (priceM ? parsePriceLei(priceM[1]) : null) ?? 0;
    const imgM = b.match(/<img[^>]+(?:data-src|src)="([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i);
    if (!name || !(price > 0)) continue;
    const abs = url.startsWith("http") ? url : `${BASE}/${url.replace(/^\//, "")}`;
    out.push({ name: normVol(name), brand: "", price, available: true, url: abs, productUrl: abs, rawPriceText: priceM ? priceM[1] : null, image: imgM ? imgM[1] : null, category: cat });
  }
  return out;
}

async function main() {
  const merchant = await prisma.merchant.upsert({
    where: { slug: "lemanoir" },
    update: { active: true, name: "Le Manoir", websiteUrl: BASE, color: "#7b1e3b" },
    create: { slug: "lemanoir", name: "Le Manoir", websiteUrl: BASE, color: "#7b1e3b" },
  });

  const pool: StoreProduct[] = [];
  const seen = new Set<string>();
  for (const c of CATS) {
    let catAdded = 0;
    for (let p = 1; p <= MAX_PAGES; p++) {
      let html: string;
      try {
        const res = await fetch(`${BASE}/${c.path}${p > 1 ? `?p=${p}` : ""}`, { headers: { "user-agent": UA, "accept-language": "ro-RO" } });
        if (!res.ok) break;
        html = await res.text();
      } catch {
        break;
      }
      const prods = parseProducts(html, c.cat);
      if (prods.length === 0) break;
      let pageAdded = 0;
      for (const pr of prods) {
        if (seen.has(pr.url)) continue;
        seen.add(pr.url);
        pool.push(pr);
        pageAdded++;
        catAdded++;
      }
      if (pageAdded === 0) break;
      await sleep(500);
    }
    console.log(`  ${c.path.padEnd(40)} +${catAdded} (pool ${pool.length})`);
  }
  console.log(`Pooled ${pool.length} Le Manoir products.`);

  const r = await matchPoolToCatalog(merchant.id, pool, { section: "alcohol", addNew: true, label: "lemanoir" });
  console.log(`\nLe Manoir: ${r.offers} offers (${r.created} new alcohol products) from pool ${pool.length}.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
