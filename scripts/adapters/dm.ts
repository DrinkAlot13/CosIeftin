// dm drogerie markt România — cosmetics/personal-care drugstore chain.
//
// Before this, the `cosmetice` section had exactly ONE source (Farmacia Tei): every "comparison"
// there was really just one shop's price with nothing to compare it against. Investigated and
// ruled out first, same as the merchants CLAUDE.md already lists as dead ends: Dr. Max and
// Sensiblu (same company, same Cloudflare managed challenge that already stopped Douglas —
// beating it needs the residential proxies that turn a manageable legal question into a real
// one) and Catena (reachable, but no product page — RO or EN — ever renders a visible price;
// its own search API (`POST /ajax/es_search`) returns a `price` field on every hit with
// `show_price: false` next to it, which reads as a deliberate "not shown without an account"
// policy, not a missing feature. Publishing a number the merchant chose to withhold from its own
// shoppers is the Lidl-RO situation again — a site with no real public price to scrape.
//
// dm.ro has none of that: plain `curl` with a browser UA gets a 200 (no Cloudflare challenge),
// `/robots.txt` names a real `/product-sitemap.xml`, and the storefront's own `/scripts/head.js`
// hands over its API config in the clear:
//
//     productDataServiceUrl: "https://products.dm.de/product"
//     productSearchServiceUrl: "https://product-search.services.dmtech.com"
//     tenantId: "dm-shop-ro-ro"
//
// The product-detail widget (`product-dm.min.js`) calls
// `GET {productDataServiceUrl}/products/tiles/{country}/dans/{dans}` — `dans` takes a
// COMMA-JOINED LIST, so one request prices up to ~200 products at once (tested: 200 = 200
// results, 250 = HTTP 400 — the cap sits between the two, so routes below stay well under it).
// An id that does not exist is simply absent from the response, never a null placeholder, so a
// discontinued product silently drops out rather than writing a wrong row.
//
// WHY ROUTES ARE DISCOVERED, NOT HARDCODED. The product set is ~11,000 items and changes
// nightly (new SKUs, discontinued lines). A fixed id list goes stale the way Penny's fixed week
// number did. The sitemap is dm's own current statement of what exists, so each run re-derives
// its own batches from it.
import type { Adapter, Route } from "./types";

const BASE = "https://www.dm.ro";
const API = "https://products.dm.de/product/products/tiles/ro/dans/";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Measured, not assumed: 200 ids → 200 results; 250 ids → HTTP 400. 180 leaves margin without
// giving up much batching efficiency (~11,000 products in ~65 requests rather than ~11,000).
const BATCH_SIZE = 180;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Read dm's own product sitemap and turn it into one Route per id batch.
 *
 * Returns [] on anything unexpected — a 404'd sitemap or a URL shape with no numeric id — so the
 * runner records a failed run instead of silently scraping nothing.
 */
async function discoverDmRoutes(): Promise<Route[]> {
  const res = await fetch(`${BASE}/product-sitemap.xml`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`product sitemap HTTP ${res.status}`);
  const xml = await res.text();

  const ids = new Set<string>();
  for (const m of xml.matchAll(/\/p\/d\/(\d+)\//g)) ids.add(m[1]);
  if (ids.size === 0) return [];

  return chunk([...ids], BATCH_SIZE).map((batch) => ({ url: `${API}${batch.join(",")}` }));
}

export const dm: Adapter = {
  slug: "dm",
  name: "dm drogerie markt",
  websiteUrl: BASE,
  color: "#002878",
  storeType: "online",
  priceChannel: "delivery",
  section: "cosmetice",
  addNew: true,
  mode: "json",
  delayMs: 1200,
  discoverRoutes: discoverDmRoutes,
  // Documents the shape; `discoverRoutes` is the live source of truth and this exact id list
  // will drift as the catalog changes, same convention as penny.ts's hardcoded week.
  routes: [{ url: `${API}2036693,2611994` }],
  json: {
    // dm's batch endpoint returns an OBJECT keyed by dan id, not an array — see runner.ts's
    // `parseJsonPayload`, which reads either shape via Object.values().
    items: "products",
    name: "title.tileHeadline",
    price: "price.price.current.value",
    link: "self",
    image: "images.0.tileSrc",
    brand: "brand.name",
    ean: "gtin",
  },
};
