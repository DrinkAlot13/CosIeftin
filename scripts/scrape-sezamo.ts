// REAL scraper: Sezamo (sezamo.ro — Rohlik-group online grocery delivery, Bucharest).
// True retail single-unit prices (good comparability). The site is a client-rendered
// SPA but its JSON API is reachable by plain fetch (no Cloudflare challenge):
//   1) /api/v1/categories/normal/{catId}/products?page=N&size=100 -> productIds
//   2) /api/v1/products/card?products=ID&ID...                    -> name/brand/size/price/image
//
// Run: npm run scrape:sezamo

import { prisma } from "../src/lib/db";
import { matchPoolToCatalog } from "../src/lib/scrape-util";

const BASE = "https://www.sezamo.ro";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const SIZE = 100; // productIds per listing page
const MAX_PAGES = 30; // up to ~3000 products/category
const BATCH = 40; // card ids per request
const H = { "user-agent": UA, "accept-language": "ro-RO", accept: "application/json", referer: `${BASE}/` };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Top-level food categories (id -> slug), from the site navigation.
const CATS = [
  { id: 627, slug: "fructe-si-legume" },
  { id: 626, slug: "brutarie-si-patiserie" },
  { id: 631, slug: "lactate-si-oua" },
  { id: 628, slug: "carne-si-peste" },
  { id: 629, slug: "mezeluri" },
  { id: 630, slug: "ready-to-eat-cook" },
  { id: 632, slug: "bacanie" },
  { id: 633, slug: "produse-congelate" },
  { id: 2621, slug: "plant-based" },
];

type Cand = { name: string; brand: string; code: string; price: number; available: boolean; url: string; image: string | null };

async function getJson(url: string): Promise<any> {
  const r = await fetch(url, { headers: H });
  if (!r.ok) throw new Error(`status ${r.status}`);
  return r.json();
}

async function listCategory(catId: number): Promise<number[]> {
  const ids: number[] = [];
  const seen = new Set<number>();
  for (let page = 0; page < MAX_PAGES; page++) {
    let data: any;
    try { data = await getJson(`${BASE}/api/v1/categories/normal/${catId}/products?page=${page}&size=${SIZE}&sort=recommended&filter=`); }
    catch { break; }
    const pageIds: number[] = (data?.productIds || []).filter((x: unknown) => typeof x === "number");
    let added = 0;
    for (const id of pageIds) if (!seen.has(id)) { seen.add(id); ids.push(id); added++; }
    if (pageIds.length < SIZE || added === 0) break; // last page
    await sleep(250);
  }
  return ids;
}

async function cards(ids: number[]): Promise<Cand[]> {
  const out: Cand[] = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    let data: any;
    try { data = await getJson(`${BASE}/api/v1/products/card?${batch.map((id) => "products=" + id).join("&")}`); }
    catch { continue; }
    for (const p of data || []) {
      const price = p?.prices?.salePrice ?? p?.prices?.originalPrice;
      if (typeof price !== "number" || price <= 0 || !p.name) continue;
      const size = p.textualAmount ? ` ${p.textualAmount}` : "";
      out.push({
        name: `${p.name}${size}`, // fold size into name so parseSize can read it
        brand: p.brand || "",
        code: String(p.productId),
        price,
        available: p?.stock?.availabilityStatus === "AVAILABLE",
        url: p.slug ? `${BASE}/${p.slug}` : BASE,
        image: p?.image?.path || null,
      });
    }
    await sleep(250);
  }
  return out;
}

async function main() {
  const merchant = await prisma.merchant.upsert({
    where: { slug: "sezamo" },
    update: { active: true, name: "Sezamo", websiteUrl: BASE, color: "#00b140" },
    create: { slug: "sezamo", name: "Sezamo", websiteUrl: BASE, color: "#00b140" },
  });

  const pool: Cand[] = [];
  const seen = new Set<string>();
  for (const c of CATS) {
    let catAdded = 0;
    try {
      const ids = await listCategory(c.id);
      const cs = await cards(ids);
      for (const p of cs) if (!seen.has(p.code)) { seen.add(p.code); pool.push(p); catAdded++; }
      console.log(`  ${c.slug.padEnd(24)} ids ${ids.length} -> +${catAdded} (pool ${pool.length})`);
    } catch (e) {
      console.log(`  ${c.slug.padEnd(24)} eroare: ${(e as Error).message}`);
    }
    await sleep(300);
  }
  console.log(`Pooled ${pool.length} Sezamo products.`);

  const r = await matchPoolToCatalog(
    merchant.id,
    // provenance travels with every offer: the deep link and the exact source string
    pool.map((c) => ({ name: c.name, brand: c.brand, price: c.price, available: c.available, url: c.url, productUrl: c.url === BASE ? null : c.url, rawPriceText: String(c.price), image: c.image })),
    { addNew: true },
  );
  console.log(`\nSezamo: ${r.offers} offers (${r.created} new products) from pool ${pool.length}.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
