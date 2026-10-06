// King.ro ("Bautura Ta Online S.R.L.") — a curated premium spirits/wine retailer. Added
// alongside WineMag so the `alcohol` section has a second real catalog behind it, not just a
// second grocery-chain wine aisle: King's own llms.txt literally advertises itself as premium
// (est. 1994) and its product mix (Dom Pérignon, rare whisky, etc.) complements WineMag's
// broader, cheaper-leaning catalog rather than duplicating it.
//
// A BESPOKE SCRIPT, NOT A DECLARATIVE ADAPTER, because the shape doesn't fit either `mode`:
//   - Not `"json"`: the response is an HTML page, not a bare JSON body.
//   - Not `"dom"` either: the data isn't in the rendered DOM tiles at all — it's a full
//     schema.org Product array (name/price/brand/availability) embedded as ONE JSON blob in
//     `<script type="application/ld+json" id="king-jsonld">`, server-rendered, no JS needed.
//     That means plain `fetch`, no Playwright, no crash-prone long-lived Page (see
//     scripts/adapters/runner.ts's WineMag postmortem for what that cost there).
//
// WHY THESE 12 CATEGORIES. king.ro's own llms.txt lists the full nav; "Soft Drinks" is
// non-alcoholic (out of scope for this section), and "Top 100"/"Noutăți"/"Limited Edition"/
// "Rare & Exceptional"/"Savureaza Victoria" are curated CROSS-CATEGORY collections — scraping
// them would only re-find products already reachable from their real category, the same
// reasoning as skipping WineMag's brand pages. "bauturi-alcoolice" and "ready-to-drink" were
// tried and dropped: both returned a page with no ItemList at all (a different template, not a
// product grid), measured via a quick probe rather than assumed working.
//
// Run: npm run scrape:king

import { prisma } from "../src/lib/db";
import { matchPoolToCatalog, type StoreProduct } from "../src/lib/scrape-util";
import { parsePriceDetailed, baniToLei } from "../src/lib/price/parsePrice";
import { ParseTally } from "../src/lib/price/parseTally";

const BASE = "https://king.ro";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const PAGE_SIZE = 24;
const REQUEST_TIMEOUT_MS = 20_000;
// robots.txt states no crawl-delay and explicitly welcomes AI crawlers (GPTBot, ClaudeBot,
// PerplexityBot, …), but a sustained 1.2s cadence over `vinuri`'s 50 pages measurably triggered
// a 429 partway through — the site accepts bursts, not a long steady run. 1.8s cleared it on
// retry; kept as the base rate rather than the shorter default.
const DELAY_MS = 1800;
const MAX_PAGES = 80; // 80 * 24 = 1920, comfortably above the largest category (vinuri, 1200)

const CATEGORIES = [
  "vinuri", "vinuri-spumante", "sampanie", "whisky-whiskey", "rum-rom", "gin", "vodka",
  "coniac", "brandy-armagnac", "lichior", "tequila", "bauturi-miniatura",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type KingOffer = { price?: string | number; priceCurrency?: string; availability?: string };
type KingProduct = { name?: string; url?: string; image?: string; brand?: { name?: string }; offers?: KingOffer };
type KingItemList = { "@type"?: string; numberOfItems?: number; itemListElement?: { item?: KingProduct }[] };

export function extractItemList(html: string): KingItemList | null {
  const m = html.match(/<script type="application\/ld\+json" id="king-jsonld">([\s\S]*?)<\/script>/);
  if (!m) return null;
  let data: unknown;
  try { data = JSON.parse(m[1]); } catch { return null; }
  if (!Array.isArray(data)) return null;
  return (data.find((x) => (x as KingItemList)["@type"] === "ItemList") as KingItemList) ?? null;
}

/** Thrown when a page is STILL rate-limited after every retry — distinct from "page doesn't
 * exist", because the two need opposite responses: a 404 means the category ended, a
 * persistent 429 means the run cannot trust what it has NOT yet read. */
class RateLimited extends Error {}

/**
 * Retry on a non-OK response, not just on a thrown network error — and retry a 429 far harder
 * than anything else.
 *
 * The first live run's one-retry/3s version dropped 6 of 12 categories to "0 items" right
 * after `vinuri`'s 50-page pull, and the SECOND run (1.8s base delay, same one retry) still lost
 * `vinuri` to 960/1200 and `vinuri-spumante` to 0 outright — both confirmed as HTTP 429 in the
 * log, not a mystery timeout. Each category in isolation, minutes later, came back 200. So the
 * site's limit is a short window, not a hard block: a FEW seconds of backoff clears it, and the
 * site is polite enough to say so when it can — `Retry-After` is honoured when present.
 */
async function fetchCategoryPage(slug: string, page: number): Promise<string | null> {
  const url = page === 1 ? `${BASE}/${slug}/` : `${BASE}/${slug}/?page=${page}`;
  const MAX_ATTEMPTS = 5;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (res.ok) return res.text();
    if (res.status === 429) {
      if (attempt === MAX_ATTEMPTS) {
        throw new RateLimited(`${url} still 429 after ${MAX_ATTEMPTS} attempts`);
      }
      const retryAfterHeader = Number(res.headers.get("retry-after"));
      const backoffMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
        ? retryAfterHeader * 1000
        : 4000 * attempt; // 4s, 8s, 12s, 16s — exponential-ish, not exponential-explosive
      console.log(`  ${url} → HTTP 429 (attempt ${attempt}/${MAX_ATTEMPTS}, waiting ${backoffMs}ms)`);
      await sleep(backoffMs);
      continue;
    }
    // Not a rate limit — a genuine HTTP error (404 past the last real page, a 500, …). One
    // retry covers a blip; a repeat means the page really is what it says it is.
    if (attempt > 1) { console.log(`  ${url} → HTTP ${res.status}`); return null; }
    console.log(`  ${url} → HTTP ${res.status} (retrying once)`);
    await sleep(3000);
  }
  return null;
}

async function main() {
  const pool: StoreProduct[] = [];
  const seen = new Set<string>();
  const tally = new ParseTally("King.ro");
  // A category that is STILL rate-limited after fetchCategoryPage's own retries means pages
  // past this point were never read — not that they are empty. The same principle as
  // runner.ts's `browserDied`: a non-empty pool from a run that stopped reading partway through
  // is not "fewer products", it looks exactly like a complete run to every downstream check.
  let rateLimited = false;

  for (const slug of CATEGORIES) {
    if (rateLimited) break;
    let added = 0;
    let totalPages = 1;
    for (let pg = 1; pg <= MAX_PAGES; pg++) {
      let html: string | null;
      try {
        html = await fetchCategoryPage(slug, pg);
      } catch (e) {
        if (e instanceof RateLimited) {
          console.log(`  ${(e as Error).message}`);
          rateLimited = true;
          break;
        }
        console.log(`  ${BASE}/${slug}/?page=${pg} error: ${(e as Error).message.slice(0, 50)}`);
        break;
      }
      if (html == null) break;
      const list = extractItemList(html);
      if (!list || !Array.isArray(list.itemListElement) || list.itemListElement.length === 0) break;
      totalPages = Math.max(1, Math.ceil((list.numberOfItems ?? list.itemListElement.length) / PAGE_SIZE));

      for (const el of list.itemListElement) {
        const item = el.item;
        if (!item || !item.name || !item.url) continue;
        const key = item.url;
        if (seen.has(key)) continue;
        seen.add(key);

        // Availability read before the price — same ordering CLAUDE.md requires for every
        // merchant, here because an out-of-stock premium bottle legitimately has no live price.
        const available = item.offers?.availability?.includes("InStock") ?? true;
        const rawPriceText = item.offers?.price != null ? `${item.offers.price} RON` : "";
        const det = parsePriceDetailed(rawPriceText);
        if (det.priceBani == null && !available) { tally.recordUnavailable(); continue; }
        const priceBani = tally.record(rawPriceText, det.priceBani);

        pool.push({
          name: item.name,
          brand: item.brand?.name ?? "",
          price: priceBani == null ? 0 : baniToLei(priceBani),
          rawPriceText,
          rawSourceBlob: JSON.stringify(item).slice(0, 4096),
          available,
          url: item.url,
          productUrl: item.url,
          image: item.image ?? null,
          category: slug,
          categoryPath: slug,
        });
        added++;
      }
      if (pg >= totalPages) break;
      await sleep(DELAY_MS);
    }
    console.log(`  ${slug.padEnd(20)} +${added} (pool ${pool.length}, ${totalPages}p)`);
    await sleep(DELAY_MS);
  }

  tally.reportAndRaise();
  console.log(`Pooled ${pool.length} King.ro products.`);

  if (rateLimited) {
    console.error(`[king] still rate-limited after retries — ${pool.length} products pooled before that point is incomplete, not final. Refusing to write a partial catalog as if it were complete.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  if (pool.length === 0) {
    console.error("[king] no products — refusing to touch the database.");
    await prisma.$disconnect();
    process.exit(1);
  }

  const merchant = await prisma.merchant.upsert({
    where: { slug: "king" },
    update: { active: true, name: "King.ro", websiteUrl: BASE, color: "#1a1a1a", storeType: "online", priceChannel: "delivery" },
    create: { slug: "king", name: "King.ro", websiteUrl: BASE, color: "#1a1a1a", storeType: "online", priceChannel: "delivery" },
  });
  const r = await matchPoolToCatalog(merchant.id, pool, { section: "alcohol", addNew: true, label: "king" });
  if (r.aborted) console.error(`\nKing.ro: ABORTED — ${r.reason}`);
  else console.log(`\nKing.ro: ${r.offers} offers (${r.created} new, ${r.flagged} flagged) from pool ${pool.length}.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
