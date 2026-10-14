// REAL scraper: Freshful (freshful.ro, eMAG — a Next.js app). Product data is
// server-rendered into __NEXT_DATA__ on category pages (allowed by robots; the
// /api/v2/shop JSON API is robots-DISALLOWED, so we parse the page instead).
//
// ── ROUTES ARE DISCOVERED FROM robots.txt's OWN sitemap, NOT HARDCODED, after the hardcoded
// list proved exactly as stale as DM's comment warned a fixed id list would be. Confirmed live
// on 2026-10-13: 2 of the 12 hardcoded department slugs 404'd outright (the site had renamed
// "6-congelate" to "6-produse-congelate" and retired "10-bacanie" entirely, replacing it with
// "10-dietetic-bio-si-international"), and 3 whole departments the site now publishes
// (mama-si-copilul, casa-si-agrement, pet-shop) were never in the list at all because they did
// not exist when it was written. Because leaf subcategories were discovered by crawling FROM
// the department pages, losing a department silently took every leaf under it too — not a few
// missing products, whole sections of the catalog invisible to this scraper for as long as it
// had been stale. `sitemap/taxons.xml` is the site's own current statement of its full category
// tree (635 nodes, 528 of them leaves) and self-corrects the way DM's sitemap-driven discovery
// already does, so this class of drift cannot recur silently.
//
// `casa-si-agrement` (home/leisure) and `pet-shop` are DELIBERATELY EXCLUDED: neither fits any
// of this catalog's five sections, and — the more important reason — no other merchant here
// scrapes pet or home-leisure goods, so pulling them in would only add single-shop products with
// nothing to ever compare them against, making the comparability problem worse, not better.
// `mama-si-copilul` (baby/mother) IS included: baby goods already have a home in the category
// tree (Bebeluși) and real cross-store overlap via merchants that already carry them.
//
// ── THE 60-PRODUCT-PER-LEAF CEILING THIS CANNOT FIX. Confirmed live: a leaf page's own JSON
// reports `{"itemsPerPage":60,"total":86,...}` for one category — 86 real products, 60 served —
// and `?page=2` on the same URL returns the IDENTICAL 60 (verified byte-for-byte on the first
// product code), so there is no page parameter this page respects. The only route to the rest is
// the `/api/v2/shop` endpoint `robots.txt` disallows, which this scraper has always deliberately
// not called. So `total` is read and reported per leaf via `noteCap` when it exceeds what was
// served — a real, named, visible gap, not a silently short catalog pretending to be complete.
//
// Run: npm run scrape:freshful   (after: npm run setup)

import { prisma } from "../src/lib/db";
import { matchPoolToCatalog, type StoreProduct } from "../src/lib/scrape-util";
import { noteCap } from "../src/lib/truncation";

// No request may hang forever. `fetch` waits on a stalled connection indefinitely, and one
// such socket in the DCNeu detail pass stopped the whole nightly dead at 5,500 of 6,034
// products with the process using zero CPU — and because scrape-all runs stores in sequence,
// the three stores queued behind it never ran at all. Nothing crashed, so nothing reported it.
const REQUEST_TIMEOUT_MS = 20_000;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const BASE = "https://www.freshful.ro";
const DELAY_MS = 700;

// See the header comment: these two top-level departments are not grocery/alcohol/dcneu/
// cosmetice/farmacie, and no other merchant here carries pet or home-leisure goods either.
const EXCLUDED_DEPARTMENTS = new Set(["14-casa-si-agrement", "15-pet-shop"]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The pool IS the contract — no local shape, so no re-map at the matcher call.
type Candidate = StoreProduct;

function firstUrl(o: unknown): string | null {
  if (typeof o === "string") return o.startsWith("http") ? o : null;
  if (o && typeof o === "object") for (const v of Object.values(o)) { const u = firstUrl(v); if (u) return u; }
  return null;
}

/** Every LEAF (3rd-level) category path from the site's own taxonomy sitemap, department-filtered. */
async function discoverLeaves(): Promise<string[]> {
  const res = await fetch(`${BASE}/sitemap/taxons.xml`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`taxons sitemap HTTP ${res.status}`);
  const xml = await res.text();
  const locs = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
  const leaves: string[] = [];
  for (const loc of locs) {
    if (!loc.startsWith(`${BASE}/c/`)) continue;
    const path = loc.slice(BASE.length);
    const segs = path.split("/").filter(Boolean); // ["c", "{dept}", "{sub}", "{leaf}"]
    if (segs.length !== 4) continue; // depth 3 under /c/ is a leaf; anything else is a department or subdept
    if (EXCLUDED_DEPARTMENTS.has(segs[1])) continue;
    leaves.push(path);
  }
  return leaves;
}

/** Fetch one leaf page: its products, plus the site's own reported total/page-size for that leaf. */
async function fetchLeaf(path: string): Promise<{ products: Candidate[]; total: number | null; itemsPerPage: number | null }> {
  const res = await fetch(`${BASE}${path}`, { headers: { "user-agent": UA, "accept-language": "ro-RO" }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`status ${res.status}`);
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return { products: [], total: null, itemsPerPage: null };
  const data = JSON.parse(m[1]);
  const products: Candidate[] = [];
  let total: number | null = null;
  let itemsPerPage: number | null = null;
  (function walk(o: any, d: number) {
    if (!o || typeof o !== "object" || d > 20) return;
    if (Array.isArray(o)) { for (const x of o) walk(x, d + 1); return; }
    // The leaf's own category object: {"itemsPerPage":60,"total":86,"name":...,"slug":...} —
    // confirmed live, not guessed, so read it exactly where it sits rather than scanning for
    // a bare "total" key that could belong to anything.
    if (typeof o.total === "number" && typeof o.itemsPerPage === "number" && typeof o.slug === "string") {
      total = o.total;
      itemsPerPage = o.itemsPerPage;
    }
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
      return;
    }
    for (const k of Object.keys(o)) walk(o[k], d + 1);
  })(data.props?.pageProps ?? data, 0);
  return { products, total, itemsPerPage };
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

  const leaves = await discoverLeaves();
  console.log(`Discovered ${leaves.length} leaf categories from the taxonomy sitemap.`);

  for (const leaf of leaves) {
    try {
      const { products, total, itemsPerPage } = await fetchLeaf(leaf);
      const added = addProducts(products);
      if (added > 0) console.log(`  ${leaf.replace("/c/", "").padEnd(48)} +${added} (pool ${pool.length})`);
      if (total !== null) noteCap(`freshful:${leaf}`, total, products.length, itemsPerPage ?? products.length);
    } catch (e) {
      console.log(`  ${leaf} eroare: ${(e as Error).message}`);
    }
    await sleep(DELAY_MS);
  }

  // ── addNew ON (2026-09-08). Re-projected AFTER mega-image and carrefour, not before:
  // the first projection put this step at 93.4% and over the brief's line, but Carrefour
  // matched onto 155 products Mega Image had just created, so the line moved. 92.9% projected,
  // 175 new duplicate groups. Measured after, and the measurement decides.
  const r = await matchPoolToCatalog(merchant.id, pool, { label: "freshful", addNew: true });
  console.log(`\nFreshful: ${r.offers} offers matched (pool ${pool.length}).`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
