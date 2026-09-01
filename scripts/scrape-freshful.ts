// REAL scraper: Freshful (freshful.ro, eMAG — a Next.js app). Product data is
// server-rendered into __NEXT_DATA__ on category pages (allowed by robots; the
// /api/v2/shop JSON API is robots-DISALLOWED, so we parse the page instead).
//
// Department pages are slot-based (only preview a few products each), so we first
// crawl the departments to DISCOVER their leaf subcategory pages (e.g.
// /c/3-fructe-si-legume/302-legume-proaspete), then fetch each leaf (~60 products
// SSR'd) and pool them all. Polite: rate-limited, browser UA.
//
// Run: npm run scrape:freshful   (after: npm run setup)

import { prisma } from "../src/lib/db";
import { matchPoolToCatalog, type StoreProduct } from "../src/lib/scrape-util";

// No request may hang forever. `fetch` waits on a stalled connection indefinitely, and one
// such socket in the DCNeu detail pass stopped the whole nightly dead at 5,500 of 6,034
// products with the process using zero CPU — and because scrape-all runs stores in sequence,
// the three stores queued behind it never ran at all. Nothing crashed, so nothing reported it.
const REQUEST_TIMEOUT_MS = 20_000;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const BASE = "https://www.freshful.ro";
const DELAY_MS = 700;

// Seed department pages; leaf subcategories are discovered from their slots.
const DEPARTMENTS = [
  "1-brutarie-si-patiserie",
  "2-carne-si-peste",
  "3-fructe-si-legume",
  "4-lactate-branzeturi-si-oua",
  "5-mezeluri-si-ready-to-cook",
  "6-congelate",
  "7-bauturi-si-tutun",
  "8-ceva-sarat",
  "9-ceva-dulce",
  "10-bacanie",
  "11-cosmetice-si-ingrijire-personala",
  "13-detergent-si-igienizare",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The pool IS the contract — no local shape, so no re-map at the matcher call.
type Candidate = StoreProduct;

function firstUrl(o: unknown): string | null {
  if (typeof o === "string") return o.startsWith("http") ? o : null;
  if (o && typeof o === "object") for (const v of Object.values(o)) { const u = firstUrl(v); if (u) return u; }
  return null;
}

const LEAF_RE = /^\/c\/\d[\w-]*(?:\/\d[\w-]*){1,2}$/i; // /c/{dept}/{subcat}[/{sub}]

// Fetch one /c/... page: return its products + any leaf subcategory paths it links to.
async function fetchPage(path: string): Promise<{ products: Candidate[]; leaves: string[] }> {
  const res = await fetch(`${BASE}${path}`, { headers: { "user-agent": UA, "accept-language": "ro-RO" }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`status ${res.status}`);
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return { products: [], leaves: [] };
  const data = JSON.parse(m[1]);
  const products: Candidate[] = [];
  const leaves = new Set<string>();
  (function walk(o: any, d: number) {
    if (!o || typeof o !== "object" || d > 20) return;
    if (Array.isArray(o)) { for (const x of o) walk(x, d + 1); return; }
    if (typeof o.name === "string" && typeof o.price === "number" && "isAvailable" in o) {
      const url = o.slug ? `${BASE}/p/${o.slug}` : BASE;
      products.push({
        sourceId: String(o.code ?? o.sku ?? o.slug ?? o.name),
        name: o.name,
        brand: o.brand ?? "",
        price: o.price,
        available: !!o.isAvailable,
        url,
        // Provenance is set HERE, where the data is read — not at the matcher call, where a
        // narrowing map can drop it without the compiler noticing.
        productUrl: o.slug ? url : null,
        rawPriceText: String(o.price),
        rawSourceBlob: JSON.stringify(o).slice(0, 4096),
        image: firstUrl(o.image),
      });
    }
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (typeof v === "string" && LEAF_RE.test(v)) leaves.add(v);
      else walk(v, d + 1);
    }
  })(data.props?.pageProps ?? data, 0);
  return { products, leaves: [...leaves] };
}

async function main() {
  const merchant = await prisma.merchant.upsert({
    where: { slug: "freshful" },
    update: { active: true, name: "Freshful", websiteUrl: BASE, color: "#00a651" },
    create: { slug: "freshful", name: "Freshful", websiteUrl: BASE, color: "#00a651" },
  });

  const pool: Candidate[] = [];
  const byCode = new Set<string>();
  const addProducts = (cands: Candidate[]) => {
    let added = 0;
    for (const c of cands) { const k = c.sourceId ?? c.name; if (!byCode.has(k)) { byCode.add(k); pool.push(c); added++; } }
    return added;
  };

  // Pass 1: crawl departments, collect products + discover leaf subcategories.
  const leaves = new Set<string>();
  for (const dep of DEPARTMENTS) {
    try {
      const { products, leaves: found } = await fetchPage(`/c/${dep}`);
      const added = addProducts(products);
      for (const l of found) leaves.add(l);
      console.log(`  dept ${dep.padEnd(34)} +${added} (pool ${pool.length}, ${found.length} leaves)`);
    } catch (e) {
      console.log(`  dept ${dep.padEnd(34)} eroare: ${(e as Error).message}`);
    }
    await sleep(DELAY_MS);
  }

  // Pass 2: fetch every discovered leaf subcategory page.
  console.log(`\nDiscovered ${leaves.size} leaf subcategories; fetching...`);
  for (const leaf of leaves) {
    try {
      const { products } = await fetchPage(leaf);
      const added = addProducts(products);
      if (added > 0) console.log(`  leaf ${leaf.replace("/c/", "").padEnd(48)} +${added} (pool ${pool.length})`);
    } catch (e) {
      console.log(`  leaf ${leaf} eroare: ${(e as Error).message}`);
    }
    await sleep(DELAY_MS);
  }

  const r = await matchPoolToCatalog(merchant.id, pool, { label: "freshful" });
  console.log(`\nFreshful: ${r.offers} offers matched (pool ${pool.length}).`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
