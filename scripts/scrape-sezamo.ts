// REAL scraper: Sezamo (sezamo.ro — Rohlik-group online grocery delivery, Bucharest).
// True retail single-unit prices (good comparability). The site is a client-rendered
// SPA but its JSON API is reachable by plain fetch (no Cloudflare challenge):
//   1) /api/v1/categories/normal/{catId}/products?page=N&size=100 -> productIds
//   2) /api/v1/products/card?products=ID&ID...                    -> name/brand/size/price/image
//
// Run: npm run scrape:sezamo

import { prisma } from "../src/lib/db";
import { matchPoolToCatalog, type StoreProduct } from "../src/lib/scrape-util";

// No request may hang forever. `fetch` waits on a stalled connection indefinitely, and one
// such socket in the DCNeu detail pass stopped the whole nightly dead at 5,500 of 6,034
// products with the process using zero CPU — and because scrape-all runs stores in sequence,
// the three stores queued behind it never ran at all. Nothing crashed, so nothing reported it.
const REQUEST_TIMEOUT_MS = 20_000;

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

// The pool IS the contract — no local shape, so no re-map at the matcher call.
type Cand = StoreProduct;

async function getJson(url: string): Promise<any> {
  const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
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
      // A missing price is REFUSED, not dropped. Pooling it with price 0 sends it through
      // matchPoolToCatalog's pre-offer refusal path, which records the item and its raw
      // value; it still never becomes an offer. A bare `continue` here made an item with an
      // unreadable price indistinguishable from an item the shop does not sell.
      if (!p.name) continue;
      const priceNum = typeof price === "number" && price > 0 ? price : 0;
      const size = p.textualAmount ? ` ${p.textualAmount}` : "";
      const url = p.slug ? `${BASE}/${p.slug}` : BASE;
      out.push({
        name: `${p.name}${size}`, // fold size into name so parseQuantity can read it
        brand: p.brand || "",
        sourceId: String(p.productId),
        price: priceNum,
        available: p?.stock?.availabilityStatus === "AVAILABLE",
        url,
        // Provenance set at the READ, not at the matcher call where a map can drop it.
        productUrl: p.slug ? url : null,
        rawPriceText: String(priceNum),
        // KEEP THE SOURCE PAYLOAD — see scrape-util. Without it, no independent check on
        // our size handling is possible for this merchant.
        rawSourceBlob: JSON.stringify(p).slice(0, 4096),
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
      for (const p of cs) { const k = p.sourceId ?? p.name; if (!seen.has(k)) { seen.add(k); pool.push(p); catAdded++; } }
      console.log(`  ${c.slug.padEnd(24)} ids ${ids.length} -> +${catAdded} (pool ${pool.length})`);
    } catch (e) {
      console.log(`  ${c.slug.padEnd(24)} eroare: ${(e as Error).message}`);
    }
    await sleep(300);
  }
  console.log(`Pooled ${pool.length} Sezamo products.`);

  const r = await matchPoolToCatalog(merchant.id, pool, { addNew: true, label: "sezamo" });
  console.log(`\nSezamo: ${r.offers} offers (${r.created} new products) from pool ${pool.length}.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
