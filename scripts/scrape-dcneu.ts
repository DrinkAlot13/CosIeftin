// REAL scraper: DCNeu (comenzi.dcneu.ro) — OpenCart + Journal theme, cash & carry pricing.
//
// FULL EXTRACTION. Two passes in ONE run (the tier pass is no longer a separate bounded
// batch — that is why tier coverage used to be partial):
//   1. LISTING (plain fetch): brand, name, per-product URL, price WITH and WITHOUT VAT,
//      stock text. Both VAT figures are the only trustworthy way to know the rate.
//   2. DETAIL (Playwright, concurrent): JSON-LD (sku, mpn, model, image, availability),
//      the quantity-discount ladder, carton quantity, login gating, category path.
//      Tiers are JS-rendered, so a static fetch cannot see them.
//
// ROBOTS.TXT: dcneu disallows /*page=, /*limit=, /*sort=, /*filter=. The previous version
// paginated with ?page=N, which violated that. This one requests category URLs with NO
// query parameters at all and accepts whatever the un-parameterized page returns.
//
// Two bugs this file has already carried, both guarded now:
//   • a fixed 2600-char HTML window per card, which borrowed neighbours' prices
//   • ex-VAT prices stored as the consumer price (~21% too low)
//
// Run: npm run scrape:dcneu            (listing + detail)
//      DCNEU_DETAIL=0 npm run scrape:dcneu   (listing only, fast)

import { chromium, type Browser, type Page } from "playwright";
import { prisma } from "../src/lib/db";
import { parsePriceLei } from "../src/lib/price/parsePrice";
import { deriveVatRateBp } from "../src/lib/price/vat";
import { validateTiers, findSmearedLadders, type RawTier } from "../src/lib/price/bulkTiers";
import { matchPoolToCatalog, type StoreProduct } from "../src/lib/scrape-util";

const BASE = "https://comenzi.dcneu.ro";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MAX_CATS = Number(process.env.DCNEU_MAX_CATS ?? 90);
const DETAIL = process.env.DCNEU_DETAIL !== "0";
const DETAIL_CONCURRENCY = Number(process.env.DCNEU_CONCURRENCY ?? 4);
const DETAIL_MAX = Number(process.env.DCNEU_DETAIL_MAX ?? 0); // 0 = every product
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type DcneuProduct = StoreProduct & {
  priceWithVatBani: number | null;
  priceWithoutVatBani: number | null;
  vatRateBp: number | null;
  stockStatus: "IN_STOCK" | "OUT_OF_STOCK" | "LIMITED" | "UNKNOWN";
  sku?: string | null;
  cartonQty?: number | null;
  loginGated?: boolean;
  categoryPath?: string | null;
  tiers?: RawTier[];
};

async function getHtml(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, "accept-language": "ro-RO" } });
    return r.ok ? await r.text() : null;
  } catch {
    return null;
  }
}

/** Romanian stock wording → a status we can act on. */
export function readStock(text: string): DcneuProduct["stockStatus"] {
  const t = text.toLowerCase();
  if (/nu\s*(este|e)?\s*[iî]n\s*stoc|stoc\s*epuizat|indisponibil|out\s*of\s*stock/.test(t)) return "OUT_OF_STOCK";
  if (/stoc\s*limitat|ultimele|limited/.test(t)) return "LIMITED";
  if (/[iî]n\s*stoc|in\s*stock|disponibil/.test(t)) return "IN_STOCK";
  return "UNKNOWN";
}

/**
 * Parse ONE listing card. Exported for the offline fixture tests.
 * Every field comes from the card's OWN markup — a card missing its price or link is
 * dropped and counted, never handed a neighbour's data.
 */
export function parseCard(card: string): { product: DcneuProduct | null; reason?: string } {
  const linkM =
    card.match(/<a href="(https:\/\/comenzi\.dcneu\.ro\/[^"]+)"[^>]*class="product-img[^"]*"[^>]*title="([^"]+)"/i) ||
    card.match(/href="(https:\/\/comenzi\.dcneu\.ro\/[^"]+)"[^>]*title="([^"]+)"/i);
  if (!linkM) return { product: null, reason: "no-link" };
  const url = linkM[1];
  const name = linkM[2].replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  if (!name) return { product: null, reason: "no-name" };

  // The consumer price, from its OWN element — never the "Fără TVA" figure beside it.
  const priceM = card.match(/class="price-normal"[^>]*>([^<]+)</i) || card.match(/class="price-new"[^>]*>([^<]+)</i);
  if (!priceM) return { product: null, reason: "no-price-element" };
  const rawPriceText = priceM[1].replace(/\s+/g, " ").trim();
  const withVatLei = parsePriceLei(rawPriceText);
  if (withVatLei == null) return { product: null, reason: "unparseable-price" };

  // The net figure lets us DERIVE the VAT rate per product, which matters because DCNeu
  // sells food (11%) and non-food (21%) side by side — one assumed rate would be wrong
  // for half the catalog.
  const taxM = card.match(/class="price-tax"[^>]*>([^<]*)</i);
  const withoutVatLei = taxM ? parsePriceLei(taxM[1]) : null;
  const priceWithVatBani = Math.round(withVatLei * 100);
  const priceWithoutVatBani = withoutVatLei == null ? null : Math.round(withoutVatLei * 100);
  const vatRateBp = priceWithoutVatBani ? deriveVatRateBp(priceWithVatBani, priceWithoutVatBani) : null;

  const brand = (card.match(/Brand:<\/span>\s*<span><a[^>]*>([^<]+)</i) || [])[1]?.trim() ?? "";
  const stockText = (card.match(/Stoc:<\/span>\s*<span>([^<]*)</i) || [])[1] ?? "";
  const oldM = card.match(/class="price-old"[^>]*>([^<]+)</i);
  const oldLei = oldM ? parsePriceLei(oldM[1]) : null;
  const img = (card.match(/<img[^>]+src="([^"]+)"/i) || [])[1] || null;

  return {
    product: {
      name,
      brand,
      price: withVatLei, // the consumer price; the legacy Float column stays lei
      priceWithVatBani,
      priceWithoutVatBani,
      vatRateBp,
      stockStatus: readStock(stockText),
      available: readStock(stockText) !== "OUT_OF_STOCK",
      url,
      productUrl: url,
      rawPriceText,
      referencePriceBani: oldLei != null && oldLei > withVatLei ? Math.round(oldLei * 100) : null,
      referencePriceKind: oldLei != null && oldLei > withVatLei ? "STRIKETHROUGH" : null,
      image: img,
      priceSource: "ONLINE",
    },
  };
}

/** Split a listing into cards bounded by the NEXT card marker — never a fixed window. */
export function parseProducts(html: string, drops?: Map<string, number>): DcneuProduct[] {
  const out: DcneuProduct[] = [];
  for (const card of html.split('class="product-thumb').slice(1)) {
    const { product, reason } = parseCard(card);
    if (!product) { if (reason && drops) drops.set(reason, (drops.get(reason) ?? 0) + 1); continue; }
    out.push(product);
  }
  return out;
}

/** Everything the DETAIL page adds. Exported for fixture tests. */
export function parseDetail(html: string): {
  sku: string | null; mpn: string | null; ean: string | null; categoryPath: string | null;
  cartonQty: number | null; loginGated: boolean; availability: DcneuProduct["stockStatus"];
} {
  let sku: string | null = null, mpn: string | null = null, ean: string | null = null;
  let availability: DcneuProduct["stockStatus"] = "UNKNOWN";
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const j = JSON.parse(m[1]) as Record<string, unknown>;
      if (j["@type"] !== "Product") continue;
      sku = (j.sku as string) || null;
      mpn = (j.mpn as string) || null;
      // GTIN under any of schema.org's spellings
      for (const k of ["gtin13", "gtin", "gtin8", "gtin12", "gtin14"]) {
        const v = j[k];
        if (typeof v === "string" && v.trim()) { ean = v.trim(); break; }
      }
      const offers = j.offers as Record<string, unknown> | undefined;
      const av = String(offers?.availability ?? "");
      if (/InStock/i.test(av)) availability = "IN_STOCK";
      else if (/OutOfStock|SoldOut/i.test(av)) availability = "OUT_OF_STOCK";
      else if (/LimitedAvailability/i.test(av)) availability = "LIMITED";
    } catch { /* a malformed block is simply skipped */ }
  }
  if (availability === "UNKNOWN") {
    const link = html.match(/itemprop="availability"[^>]*href="[^"]*schema\.org\/(\w+)"/i);
    if (link) availability = /InStock/i.test(link[1]) ? "IN_STOCK" : /OutOfStock/i.test(link[1]) ? "OUT_OF_STOCK" : "UNKNOWN";
  }
  const body = html.slice(html.indexOf("</head>"));
  const crumbs = (body.match(/class="breadcrumbs?"[\s\S]{0,1200}?<\/ul>/i) || [""])[0];
  const path = [...crumbs.matchAll(/<a[^>]*>\s*([^<]{2,40}?)\s*<\/a>/g)].map((m) => m[1].trim()).filter((x) => !/acas[ăa]/i.test(x));
  const cartonM = body.match(/(?:bax|cutie|carton|set)\D{0,12}(\d{1,4})\s*(?:buc|bucati|bucăți)/i);
  return {
    sku, mpn, ean,
    categoryPath: path.length ? path.join(" / ") : null,
    cartonQty: cartonM ? parseInt(cartonM[1], 10) : null,
    // add-to-cart replaced by a login prompt
    loginGated: /class="[^"]*btn[^"]*"[^>]*>\s*(Logare|Autentificare)\s*</i.test(body),
    availability,
  };
}

/**
 * The quantity-discount ladder, read from a RENDERED page (tiers are JS-injected).
 *
 * SCOPED TO THE PRODUCT BLOCK on purpose. Searching the whole document matched a site-wide
 * banner — a free-delivery threshold of 164,69 lei — as a "2+" tier on EVERY product, which
 * produced 5,797 rejected ladders in one run. The validation caught all of them, but a
 * reader that generates thousands of anomalies is a broken reader, not a working guard.
 */
async function readTiers(page: Page, basePriceBani: number): Promise<RawTier[]> {
  return page.evaluate((baseBani) => {
    const found = new Map<number, number>();
    const scope =
      document.querySelector(".product-info, .product-details, #product, [class*='product-info' i]") ?? document.body;
    // Even inside the product block there are cross-sell rails ("related", "also bought",
    // swiper/carousel). A ladder read from one of those belongs to a DIFFERENT product —
    // that is how one 3+ rung ended up on 84 unrelated items across 5 base prices.
    const isCrossSell = (el: Element): boolean => {
      for (let n: Element | null = el; n && n !== scope; n = n.parentElement) {
        const c = (n.className || "").toString().toLowerCase();
        const id = (n.id || "").toLowerCase();
        if (/related|also|carousel|swiper|slider|upsell|cross|recommend|similar/.test(c + " " + id)) return true;
      }
      return false;
    };
    for (const el of Array.from(scope.querySelectorAll("table tr, li, .discount, [class*='discount' i]"))) {
      if (isCrossSell(el)) continue;
      const t = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (t.length > 60) continue;
      // "3+ 7.00 Lei -10%" — the discount % is what distinguishes a real rung from
      // unrelated "N+ price" text elsewhere on the page.
      const m = t.match(/^(\d+)\s*\+?\s*(?:sau mai mult)?\s*[^\d]{0,4}([\d.]*\d[.,]\d{2})\s*lei\b[^%]{0,14}(\d+)\s*%/i);
      if (!m) continue;
      const qty = parseInt(m[1], 10);
      const price = parseFloat(m[2].replace(",", "."));
      // Belt and braces: a rung ABOVE the base price is a page banner, not a discount.
      // Filtering here keeps obvious noise out of the anomaly log entirely.
      if (qty > 1 && qty < 500 && price > 0 && Math.round(price * 100) < baseBani && !found.has(qty)) {
        found.set(qty, price);
      }
    }
    return [...found.entries()].sort((a, b) => a[0] - b[0]).map(([qty, price]) => ({ qty, price }));
  }, basePriceBani).then((rows) => rows.map((r) => ({ minQuantity: r.qty, unitPriceBani: Math.round(r.price * 100) })));
}

async function main() {
  const startedAt = new Date();
  const home = (await getHtml(`${BASE}/`)) ?? "";
  const cats = [...new Set([...home.matchAll(/href="(https:\/\/comenzi\.dcneu\.ro\/[a-z0-9-]+\/[a-z0-9-]+)"/gi)].map((m) => m[1]))]
    .filter((u) => !/\.(jpg|png|gif|css|js|woff)/i.test(u))
    .slice(0, MAX_CATS);
  console.log(`Discovered ${cats.length} leaf categories.`);

  const pool: DcneuProduct[] = [];
  const seen = new Set<string>();
  const drops = new Map<string, number>();

  for (const cat of cats) {
    const leaf = cat.split("/").filter(Boolean).pop() || "diverse";
    const catSlug = `dcneu-${leaf}`;
    await prisma.category.upsert({
      where: { slug: catSlug },
      update: { name: leaf.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), section: "dcneu" },
      create: { slug: catSlug, name: leaf.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), section: "dcneu" },
    }).catch(() => {});

    // NO query parameters — robots.txt disallows /*page=, /*limit=, /*sort=, /*filter=.
    const html = await getHtml(cat);
    if (!html) continue;
    let added = 0;
    for (const pr of parseProducts(html, drops)) {
      if (seen.has(pr.url)) continue;
      seen.add(pr.url);
      pr.category = catSlug;
      pool.push(pr);
      added++;
    }
    if (added) console.log(`  ${cat.replace(BASE + "/", "").padEnd(42)} +${added} (pool ${pool.length})`);
    await sleep(400);
  }
  console.log(`\nPooled ${pool.length} DCNeu products from the listing pass.`);
  for (const [r, n] of drops) console.log(`  dropped ${n} cards: ${r}`);

  // ── DETAIL PASS, in the SAME run ────────────────────────────────────────────────
  let detailed = 0;
  if (DETAIL && pool.length) {
    const targets = DETAIL_MAX > 0 ? pool.slice(0, DETAIL_MAX) : pool;
    console.log(`\nDetail pass over ${targets.length} products (concurrency ${DETAIL_CONCURRENCY})…`);
    const browser: Browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const ctx = await browser.newContext({ userAgent: UA, locale: "ro-RO" });
    const queue = [...targets];
    const workers = Array.from({ length: DETAIL_CONCURRENCY }, async () => {
      const page = await ctx.newPage();
      await page.addInitScript(() => { (globalThis as unknown as { __name: (f: unknown) => unknown }).__name = (f) => f; });
      for (;;) {
        const p = queue.shift();
        if (!p) break;
        try {
          await page.goto(p.url, { waitUntil: "domcontentloaded", timeout: 30000 });
          await page.waitForTimeout(900);
          const html = await page.content();
          const d = parseDetail(html);
          p.sku = d.sku; p.ean = d.ean || null; p.categoryPath = d.categoryPath;
          p.cartonQty = d.cartonQty; p.loginGated = d.loginGated;
          if (d.availability !== "UNKNOWN") {
            p.stockStatus = d.availability;
            p.available = d.availability !== "OUT_OF_STOCK";
          }
          p.tiers = await readTiers(page, p.priceWithVatBani ?? Math.round(p.price * 100));
          detailed++;
          if (detailed % 250 === 0) process.stdout.write(`\r  detailed ${detailed}/${targets.length}`);
        } catch { /* one bad page must not end the pass */ }
      }
      await page.close();
    });
    await Promise.all(workers);
    await browser.close();
    console.log(`\r  detailed ${detailed}/${targets.length} ✓`);
  }

  const merchant = await prisma.merchant.upsert({
    where: { slug: "dcneu" },
    update: { active: true, name: "DCNeu", websiteUrl: BASE, color: "#e30613" },
    create: { slug: "dcneu", name: "DCNeu", websiteUrl: BASE, color: "#e30613" },
  });
  const r = await matchPoolToCatalog(merchant.id, pool, { section: "dcneu", addNew: true, label: "dcneu" });
  if (r.aborted) { console.error(`\nDCNeu: ABORTED — ${r.reason}`); await prisma.$disconnect(); return; }

  // ── persist the extra fields + validated tiers ──────────────────────────────────
  let withTiers = 0, tierRejects = 0, vatKnown = 0, outOfStock = 0, withEan = 0, withSku = 0;
  for (const p of pool) {
    const offer = await prisma.offer.findFirst({
      where: { merchantId: merchant.id, productUrl: p.url },
      select: { id: true, priceBani: true, price: true, flagged: true },
    });
    if (!offer) continue;
    if (p.vatRateBp != null) vatKnown++;
    if (p.stockStatus === "OUT_OF_STOCK") outOfStock++;
    if (p.ean) withEan++;
    if (p.sku) withSku++;

    await prisma.offer.update({
      where: { id: offer.id },
      data: {
        vatRateBp: p.vatRateBp,
        vatBasis: "WITH_VAT", // we always store the consumer price
        stockStatus: p.stockStatus,
        sku: p.sku ?? null,
        cartonQty: p.cartonQty ?? null,
        loginGated: p.loginGated ?? false,
        categoryPath: p.categoryPath ?? null,
      },
    }).catch(() => {});

    // Validate against the price that was actually STORED, not the one we scraped. The
    // sanity gate can refuse a scraped price and keep the previous trusted one; validating
    // the ladder against the rejected figure wrote 152 rungs that sat ABOVE the live price.
    const storedBaseBani = offer.priceBani ?? Math.round(offer.price * 100);
    await prisma.bulkTier.deleteMany({ where: { offerId: offer.id } });
    // A flagged offer's price is not trusted, so a ladder hung off it cannot be either.
    if (offer.flagged) continue;
    const v = validateTiers(storedBaseBani, p.tiers ?? []);
    if (!v.ok) {
      tierRejects++;
      // A ladder that cannot be true is a parse error worth reviewing, not silent data.
      await prisma.priceAnomaly.create({
        data: { offerId: offer.id, rejectedPriceBani: p.tiers?.[0]?.unitPriceBani ?? 0, reason: `bulk tier: ${v.reason}` },
      }).catch(() => {});
      continue;
    }
    if (v.tiers.length) {
      withTiers++;
      for (const t of v.tiers) {
        await prisma.bulkTier.create({
          data: { offerId: offer.id, minQuantity: t.minQuantity, unitPriceBani: t.unitPriceBani, discountBp: t.discountBp },
        }).catch(() => {});
      }
    }
  }

  // POST-PASS: a ladder lifted from a neighbouring product is individually valid — monotonic,
  // every rung below the base — so per-product validation cannot see it. Only the POPULATION
  // gives it away: one identical ladder across products with DIFFERENT base prices.
  const written = await prisma.offer.findMany({
    where: { merchantId: merchant.id, tiers: { some: {} } },
    select: { id: true, priceBani: true, price: true, tiers: { select: { minQuantity: true, unitPriceBani: true } } },
  });
  const smeared = findSmearedLadders(
    written.map((o) => ({ offerId: o.id, basePriceBani: o.priceBani ?? Math.round(o.price * 100), tiers: o.tiers })),
  );
  let smearedRemoved = 0;
  if (smeared.offerIds.size) {
    const ids = [...smeared.offerIds];
    for (let i = 0; i < ids.length; i += 500) {
      smearedRemoved += (await prisma.bulkTier.deleteMany({ where: { offerId: { in: ids.slice(i, i + 500) } } })).count;
    }
    withTiers -= smeared.offerIds.size;
  }

  console.log(`\n─── DCNeu extraction report ───`);
  console.log(`  products pooled        : ${pool.length}`);
  console.log(`  offers written         : ${r.offers} (${r.created} new, ${r.flagged} flagged)`);
  console.log(`  detail pages read      : ${detailed}`);
  console.log(`  with bulk tiers        : ${withTiers}`);
  console.log(`  tier ladders REJECTED  : ${tierRejects} (logged to PriceAnomaly)`);
  console.log(`  ladders dropped as smeared: ${smearedRemoved} rungs across ${smeared.offerIds.size} offers`);
  console.log(`  out of stock           : ${outOfStock}`);
  console.log(`  with SKU               : ${withSku}`);
  console.log(`  with EAN               : ${withEan}`);
  console.log(`  with resolvable VAT    : ${vatKnown} / ${pool.length}`);
  console.log(`  elapsed                : ${Math.round((Date.now() - startedAt.getTime()) / 1000)}s`);
  await prisma.$disconnect();
}

// Only run when invoked directly — the parsers above are imported by fixture tests.
const invokedDirectly = process.argv[1] ? process.argv[1].replace(/\\/g, "/").endsWith("scrape-dcneu.ts") : false;
if (invokedDirectly) {
  main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
}
