// ONE adapter for every delivery-platform storefront: (platform, merchant, city) comes from a
// config row in lib/platform/config, and nothing here is Kaufland-specific.
//
// WHY PLAYWRIGHT AND NOT JSON. Verified by control experiment during recon: the Glovo web client
// makes NO product JSON call in any market — the catalog is React Server Components rendered on
// the server. There is no API to prefer, so the DOM is the source, and the RSC payload is the
// backup for fields the DOM does not show.
//
// WHY A COOKIE AND NOT AN ACCOUNT. The delivery address that unlocks the catalog lives entirely
// in a `glovo_delivery_address` cookie on OUR browser. Creating it wrote nothing to Glovo's
// servers. See docs/data-sources.md.
//
// The pool this returns is passed UNMAPPED to matchPoolToCatalog by the runner — no local shape,
// per CLAUDE.md's pool contract.

import { chromium, type Page } from "playwright";
import { existsSync } from "node:fs";
import { parsePrice } from "../../src/lib/price/parsePrice";
import { noteCap } from "../../src/lib/truncation";
import type { StoreProduct } from "../../src/lib/scrape-util";
import { GLOVO_SESSION_PATH, RATE, storeUrl, type StorefrontConfig } from "../../src/lib/platform/config";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Categories that are merchandising shelves, not aisles — they duplicate real categories. */
const SKIP_CATEGORIES = new Set([
  "Promoții", "Cele mai vândute", "#trending", "Afișează tot", "Kaufland Card XTRA",
  "Promoție Non-Food", "Mommy&Baby Land", "Parkside by Kaufland",
]);

export type GlovoScrapeResult = {
  pool: StoreProduct[];
  categoriesDiscovered: number;
  categoriesScraped: number;
  storeName: string | null;
  /** Glovo's own claim about pricing, verbatim — "Preț ca în magazin" or similar. */
  priceClaim: string | null;
};

/**
 * Scrape one storefront.
 *
 * Rate-limited on purpose and by config: a pause between categories, a pause between scroll
 * steps, and a hard scroll ceiling so a changed selector cannot spin.
 */
export async function scrapeStorefront(cfg: StorefrontConfig): Promise<GlovoScrapeResult> {
  if (!existsSync(GLOVO_SESSION_PATH)) {
    throw new Error(`No Glovo session at ${GLOVO_SESSION_PATH}. The delivery address must be created once first.`);
  }
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    storageState: GLOVO_SESSION_PATH,
    locale: "ro-RO",
    timezoneId: "Europe/Bucharest",
    viewport: { width: 1440, height: 1400 },
  });
  const page = await ctx.newPage();
  const url = storeUrl(cfg);

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(9000);

    const header = await page.evaluate(() => ({
      notFound: /nu există/i.test(document.body.innerText),
      name: document.querySelector("h1")?.textContent?.trim() ?? null,
      claim: (document.body.innerText.match(/Pre[țt][^.\n]{0,40}magazin/i) ?? [null])[0],
    }));
    if (header.notFound) {
      throw new Error(`${cfg.key}: store page renders "nu există" — the delivery address session is not being accepted.`);
    }

    const categories = await page.evaluate(() =>
      [...new Set([...document.querySelectorAll('button,[role="tab"],[role="button"]')]
        .map((b) => (b.textContent ?? "").trim())
        .filter((t) => t.length > 2 && t.length < 44))]);
    const aisles = categories.filter((c) => !SKIP_CATEGORIES.has(c) && !/^(Conectare|Aleea|Informații)/i.test(c));
    console.log(`  ${cfg.key}: ${aisles.length} aisle categories of ${categories.length} labels`);

    const bySourceId = new Map<string, StoreProduct>();
    let scraped = 0;

    for (const cat of aisles) {
      const got = await scrapeCategory(page, cat, cfg, bySourceId);
      if (got >= 0) scraped++;
      console.log(`     ${cat.padEnd(34)} +${got} (pool ${bySourceId.size})`);
      await sleep(RATE.betweenCategoriesMs);
    }

    // TRUNCATION LOUD: discovered must equal scraped, or the run says so.
    noteCap(`${cfg.key} categories`, aisles.length, scraped, aisles.length);

    return {
      pool: [...bySourceId.values()],
      categoriesDiscovered: aisles.length,
      categoriesScraped: scraped,
      storeName: header.name,
      priceClaim: header.claim,
    };
  } finally {
    await ctx.close();
    await browser.close();
  }
}

/** Open one category and harvest every product tile it renders, scrolling until it stops growing. */
async function scrapeCategory(
  page: Page,
  category: string,
  cfg: StorefrontConfig,
  out: Map<string, StoreProduct>,
): Promise<number> {
  const before = out.size;
  // Click the control IN THE PAGE by exact label. Playwright's getByText matches text nodes and
  // these labels are nested inside the button, so a locator click missed every one of the 20
  // categories and the run reported a loud, correct truncation of 0/20.
  const clicked = await page.evaluate((label) => {
    const b = [...document.querySelectorAll('button,[role="tab"],[role="button"],a')]
      .find((e) => (e.textContent ?? "").trim() === label);
    if (!b) return false;
    (b as HTMLElement).click();
    return true;
  }, category);
  if (!clicked) return -1;
  await page.waitForTimeout(5000);

  let lastCount = -1;
  for (let step = 0; step < RATE.maxScrollsPerCategory; step++) {
    const tiles = await harvest(page, category, cfg);
    for (const t of tiles) if (t.sourceId) out.set(t.sourceId, t);
    const count = await page.evaluate(() => document.querySelectorAll('[class*="ItemTile_itemTile"]').length);
    if (count === lastCount) break;
    lastCount = count;
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.9));
    await page.waitForTimeout(RATE.betweenScrollsMs);
  }
  // Back to the store root so the next category click starts from a known place — but only if
  // we actually navigated away, because a needless full page load per category cost 390s.
  if (!page.url().endsWith(cfg.storeSlug)) {
    await page.goto(storeUrl(cfg), { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(4000);
  } else {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1200);
  }
  return out.size - before;
}

/**
 * Read every tile currently in the DOM.
 *
 * EACH PRODUCT'S PRICE COMES FROM ITS OWN TILE — never a scan of surrounding HTML. That rule
 * exists because DCNeu once shipped 5,969 fabricated prices by reading a fixed window, and a
 * card missing its own price is DROPPED here rather than given a neighbour's.
 */
async function harvest(page: Page, category: string, cfg: StorefrontConfig): Promise<StoreProduct[]> {
  const pageUrl = page.url();
  const raw = await page.evaluate(() => {
    // CSS-MODULE PREFIXES, NOT FULL CLASS NAMES. Glovo ships hashed suffixes
    // (`ItemTile_itemTile__ob2HL`) that change on every deploy; the module name before the
    // double underscore is the stable part. The landing page's `data-test-id="product-tile"`
    // exists only on its carousels — the category views carry no test ids at all, which is why
    // the first run harvested 0 products from 20 successfully-opened categories.
    const tiles = document.querySelectorAll('[class*="ItemTile_itemTile"]');
    const out: {
      name: string; priceText: string; oldPriceText: string | null; image: string | null;
      sourceId: string | null; unavailable: boolean; blob: string;
    }[] = [];
    for (const tile of tiles) {
      const desc = tile.querySelector('[class*="ItemTile_description"]');
      const priceBox = tile.querySelector('[class*="ItemTile_priceContainer"]');
      // The description element contains the price too ("Rosii Roma 500G7,99 RON"), so remove
      // the price container's own text rather than regex-guessing where the name ends.
      const priceOwn = (tile.querySelector('[class*="ItemTile_priceContainer"]')?.textContent ?? "").trim();
      let name = (desc?.textContent ?? "").trim();
      if (priceOwn && name.endsWith(priceOwn)) name = name.slice(0, -priceOwn.length).trim();
      name = name.replace(/[-−]?\d+[.,]\d{2}\s*RON/g, "").trim();
      // Prices come from THIS tile's own price container — never a scan of nearby HTML.
      const priceText = (priceBox?.textContent ?? "").trim();
      const prices = [...priceText.matchAll(/(\d+[.,]\d{2})\s*RON/g)].map((m) => m[0]);
      const img = tile.querySelector("img")?.getAttribute("src") ?? null;
      const link = tile.closest("a")?.getAttribute("href") ?? tile.querySelector("a")?.getAttribute("href") ?? null;
      out.push({
        name,
        priceText: prices[0] ?? "",
        oldPriceText: prices.length > 1 ? prices[prices.length - 1] : null,
        image: img,
        sourceId: link,
        unavailable: /indisponibil|epuizat/i.test(tile.textContent ?? ""),
        blob: JSON.stringify({ text: (tile.textContent ?? "").replace(/\s+/g, " ").slice(0, 400), img, link }),
      });
    }
    return out;
  });

  const products: StoreProduct[] = [];
  for (const r of raw) {
    if (!r.name || r.name.length < 3) continue;
    // A tile with no price of its own is DROPPED, never given a neighbour's.
    const bani = parsePrice(r.priceText);
    if (bani == null) continue;
    const sourceId = r.sourceId ?? `${cfg.storeSlug}:${r.name.toLowerCase().replace(/\s+/g, "-").slice(0, 90)}`;
    const oldBani = r.oldPriceText ? parsePrice(r.oldPriceText) : null;
    products.push({
      name: r.name,
      brand: "",
      price: bani / 100,
      available: !r.unavailable,
      url: pageUrl,
      image: r.image,
      sourceId,
      priceSource: "DELIVERY_PLATFORM",
      rawPriceText: r.priceText,
      // `offerId` IS THE KEY audit-db READS to identify a store product when there is no deep
      // link. Without it the audit falls back to `url|price` — and `url` here is the CATEGORY
      // page, so 20 different Dove shower gels that all cost 31,99 collapsed into one bucket and
      // were reported as a 20-way matcher fan-out. Nothing was wrong with the matching; the
      // measurement had no identity to measure with. Keyed on the real tile: p95 1, max 6.
      rawSourceBlob: JSON.stringify({ platform: cfg.platform, store: cfg.storeSlug, category, offerId: sourceId, tile: JSON.parse(r.blob) }).slice(0, 4000),
      // GLOVO PUBLISHES NO PER-PRODUCT PERMALINK. Verified: a tile has no ancestor or descendant
      // <a> at all. The schema says an absent link must be VISIBLY NULL rather than silently
      // pointing at a generic page, so this is null and `url` carries the category page.
      //
      // Setting it to the category URL instead tripped the fabrication guard at 71.7% — the
      // guard groups on (price, productUrl) and every product in a category shared both. The
      // guard was right: a shared URL is not a deep link, and pretending otherwise would have
      // hidden that from every later check.
      productUrl: null,
      referencePriceBani: oldBani != null && oldBani > bani ? oldBani : null,
      referencePriceKind: oldBani != null && oldBani > bani ? "STRIKETHROUGH" : null,
      category,
      // The Glovo aisle label IS the merchant's own category ("Lactate, branzeturi si oua").
      categoryPath: category,
    });
  }
  return products;
}
