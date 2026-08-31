// REAL scraper: Kaufland România — weekly flyer offers (oferte săptămânale).
//
// Kaufland RO has no online shop, so there is no catalog to scrape — but the weekly-offer
// page server-renders a COMPLETE JSON feed into `window.SSR[...]`, with numeric prices,
// promo validity dates, the pre-promo price, AND the Kaufland Card loyalty price.
// That is exactly the data a price comparator wants: promo prices are where the real
// savings live, and they're invisible to a plain catalog scrape.
//
// No browser needed (plain fetch, ~1 request), so this is cheap enough to run nightly.
//
// Run: npm run scrape:kaufland

import { prisma } from "../src/lib/db";
import { matchPoolToCatalog, type StoreProduct } from "../src/lib/scrape-util";
import { parsePriceLei, leiToBaniExact } from "../src/lib/price/parsePrice";
import { ParseTally } from "../src/lib/price/parseTally";

// No request may hang forever. `fetch` waits on a stalled connection indefinitely, and one
// such socket in the DCNeu detail pass stopped the whole nightly dead at 5,500 of 6,034
// products with the process using zero CPU — and because scrape-all runs stores in sequence,
// the three stores queued behind it never ran at all. Nothing crashed, so nothing reported it.
const REQUEST_TIMEOUT_MS = 20_000;

const BASE = "https://www.kaufland.ro";
const PAGES = [
  "/oferte/oferte-saptamanale/saptamana-curenta.html",
  "/oferte/prezentare-generala-oferte.html",
];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

type KOffer = {
  offerId?: string;
  title?: string;
  subtitle?: string;
  detailTitle?: string;
  detailDescription?: string;
  detailAction?: string;
  unit?: string;
  price?: number;
  formattedPrice?: string;
  formattedOldPrice?: string;
  loyaltyFormattedPrice?: string;
  basePrice?: string;
  listImage?: string;
  dateFrom?: string;
  dateTo?: string;
  klNr?: string;
};

/** Pull every `window.SSR[...] = {...}` payload out of the page and collect its offers. */
export function extractOffers(html: string): KOffer[] {
  const out: KOffer[] = [];
  const seen = new Set<string>();
  // Each SSR blob is a JSON object literal; scan for balanced braces after the assignment.
  const re = /window\.SSR\[['"][^'"]+['"]\]\s*=\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const start = m.index + m[0].length;
    if (html[start] !== "{") continue;
    let depth = 0, end = -1, inStr = false, esc = false;
    for (let i = start; i < html.length; i++) {
      const ch = html[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    if (end < 0) continue;
    let data: unknown;
    try { data = JSON.parse(html.slice(start, end)); } catch { continue; }
    // walk the tree for objects that look like offers
    const walk = (o: unknown) => {
      if (Array.isArray(o)) { for (const v of o) walk(v); return; }
      if (!o || typeof o !== "object") return;
      const rec = o as Record<string, unknown>;
      if (typeof rec.offerId === "string" && typeof rec.title === "string") {
        if (!seen.has(rec.offerId)) { seen.add(rec.offerId); out.push(rec as KOffer); }
      }
      for (const v of Object.values(rec)) walk(v);
    };
    walk(data);
  }
  return out;
}

/**
 * Kaufland's flyer is NOT a grocery catalog — it also advertises tools, clothing, garden
 * and homeware. Those poison a grocery catalog: no unit price, no cross-store comparison,
 * and brand-only titles that collide ("Parkside 1 buc" covered 33 different tools priced
 * 9,99–219 lei). Detect and exclude them rather than trying to name them.
 *
 * Note `detailAction: "Sonderposten"` looks like a non-food flag but is not — it also tags
 * Irish Beef and potted plants, so it is deliberately NOT used here.
 */
const NON_FOOD =
  /\b(saltea|perna|plapuma|lenjerie|prosop|halat|papuci|pantofi|sosete|tricou|bluza|pantaloni|geaca|jacheta|rochie|camasa|textil|covor|perdea|draperie|scaun|dulap|raft|comoda|lampa|bec|prelungitor|incarcator|casti|boxa|telefon|tableta|laptop|televizor|aspirator|mixer|blender|prajitor|fier de calcat|masina de spalat|frigider|cuptor|unelte|surubelnita|ciocan|clesti|burghiu|bormasina|slefuitor|spaclu|vopsea|silicon|adeziv|furtun|stropitoare|ghiveci|set de scule|trotineta|bicicleta|jucarie|puzzle|minge|cort|sac de dormit|rucsac|valiza|umbrela)\b/i;

/** Non-food house brands that appear in the flyer with brand-only titles. */
const NON_FOOD_BRANDS = /^(parkside|esmara|livergy|crivit|silvercrest|powerfix|florabest|ernesto|tronic|auriol)\b/i;

/** True when this flyer tile is not a grocery product. */
export function isNonFood(o: KOffer): boolean {
  if (NON_FOOD_BRANDS.test(String(o.title ?? "").trim())) return true;
  const hay = `${o.title ?? ""} ${o.detailTitle ?? ""} ${o.subtitle ?? ""} ${o.detailDescription ?? ""}`;
  return NON_FOOD.test(hay);
}

/** Kaufland splits the pack size into `subtitle`/`unit` — fold it into the name so
 *  parseSize() can normalize it (that's what drives lei/kg comparison). */
export function toStoreProduct(o: KOffer, pageUrl: string, tally?: ParseTally): StoreProduct | null {
  // The flyer often puts only the BRAND in `title` and the real product in `detailTitle`
  // ("Parkside" + "Șpaclu pentru construcție uscată"). Taking `title` alone collapsed 33
  // distinct tools onto the name "Parkside 1 buc". Prefer the more specific of the two.
  const rawTitle = String(o.title ?? "").replace(/\s+/g, " ").trim();
  const detail = String(o.detailTitle ?? "").replace(/\s+/g, " ").trim();
  // "Reducere cu Kaufland Card" is a promo banner, never a product name
  const detailUsable = detail.length > 0 && !/reducere|kaufland card/i.test(detail);
  const title = detailUsable && detail.length > rawTitle.length ? `${rawTitle} ${detail}`.trim() : rawTitle;
  if (!title) return null;
  if (isNonFood(o)) return null;
  // "Reducere cu Kaufland Card" items carry ONLY a loyalty price. Include them (they're real
  // savings) but the loyalty price is recorded separately so the UI can label it — an
  // unlabeled card price would silently undercut every other store (invariant 9).
  const rawPrice = o.formattedPrice ?? o.loyaltyFormattedPrice ?? "";
  const parsed = typeof o.price === "number" && o.price > 0
    ? o.price
    : (parsePriceLei(o.formattedPrice) ?? parsePriceLei(o.loyaltyFormattedPrice));
  const price = tally ? tally.record(rawPrice, parsed) : parsed;
  if (price == null || !(price > 0)) return null;
  const unit = String(o.unit ?? "").replace(/\s+/g, " ").trim();
  const sub = String(o.subtitle ?? "").replace(/\s+/g, " ").trim();
  // prefer the unit string ("plasă 5 kg", "500 g") as the size carrier
  const sizePart = /\d/.test(unit) ? unit : /\d/.test(sub) ? sub : "";
  const name = sizePart && !title.toLowerCase().includes(sizePart.toLowerCase()) ? `${title} ${sizePart}` : title;
  const oldLei = parsePriceLei(o.formattedOldPrice);
  return {
    name,
    brand: "",
    price,
    available: true,
    url: BASE + pageUrl,
    // The flyer JSON carries NO per-product link. Leave productUrl null so the missing
    // deep link is visible rather than every offer pointing at the same flyer page.
    productUrl: null,
    image: o.listImage ? String(o.listImage) : null,
    // a weekly flyer promo, not a standing shelf price
    priceSource: "FLYER",
    rawPriceText: rawPrice || String(o.price ?? ""),
    rawSourceBlob: JSON.stringify(o).slice(0, 4096),
    // Kaufland states the "was" price as a STRUCTURED field, not strikethrough text
    referencePriceBani: oldLei != null && oldLei > price ? leiToBaniExact(oldLei) : null,
    referencePriceKind: oldLei != null && oldLei > price ? "STRIKETHROUGH" : null,
    promoValidFrom: o.dateFrom ? new Date(o.dateFrom) : null,
    promoValidTo: o.dateTo ? new Date(o.dateTo) : null,
  };
}

async function main() {
  const all: KOffer[] = [];
  const seen = new Set<string>();
  for (const p of PAGES) {
    try {
      const res = await fetch(BASE + p, { headers: { "User-Agent": UA, "Accept-Language": "ro-RO,ro;q=0.9" }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!res.ok) { console.log(`  ${p} → HTTP ${res.status}`); continue; }
      const html = await res.text();
      const offers = extractOffers(html);
      let added = 0;
      for (const o of offers) {
        const id = String(o.offerId);
        if (seen.has(id)) continue;
        seen.add(id);
        all.push(o);
        added++;
      }
      console.log(`  ${p.split("/").pop()!.padEnd(32)} +${added} (total ${all.length})`);
    } catch (e) {
      console.log(`  ${p} error: ${(e as Error).message.slice(0, 50)}`);
    }
  }

  const tally = new ParseTally("Kaufland");
  const pool: StoreProduct[] = [];
  const meta = new Map<string, KOffer>();
  for (const o of all) {
    const sp = toStoreProduct(o, PAGES[0], tally);
    if (sp) { pool.push(sp); meta.set(sp.name, o); }
  }
  tally.reportAndRaise();
  console.log(`Pooled ${pool.length} Kaufland offers.`);
  if (pool.length === 0) {
    console.error("Kaufland: no offers parsed — refusing to touch the database.");
    await prisma.$disconnect();
    process.exit(1);
  }

  const merchant = await prisma.merchant.upsert({
    where: { slug: "kaufland" },
    update: { active: true, name: "Kaufland", websiteUrl: BASE, color: "#e10915", storeType: "physical", priceSource: "shelf" },
    create: { slug: "kaufland", name: "Kaufland", websiteUrl: BASE, color: "#e10915", storeType: "physical", priceSource: "shelf" },
  });

  const r = await matchPoolToCatalog(merchant.id, pool, { section: "grocery", addNew: true, label: "kaufland" });
  if (r.aborted) {
    console.error(`\nKaufland: ABORTED — ${r.reason}`);
    await prisma.$disconnect();
    return;
  }

  // Enrich the offers we just wrote with promo window + loyalty price (flyer specifics).
  let enriched = 0;
  for (const [name, o] of meta) {
    const old = parsePriceLei(o.formattedOldPrice) ?? 0;
    const loyal = parsePriceLei(o.loyaltyFormattedPrice) ?? 0;
    if (!o.dateFrom && !old && !loyal) continue;
    const prod = await prisma.product.findFirst({ where: { name, section: "grocery" }, select: { id: true } });
    if (!prod) continue;
    const upd = await prisma.offer.updateMany({
      where: { productId: prod.id, merchantId: merchant.id },
      data: {
        validFrom: o.dateFrom ? new Date(o.dateFrom) : null,
        validTo: o.dateTo ? new Date(o.dateTo) : null,
        oldPrice: old > 0 ? old : null,
        loyaltyPrice: loyal > 0 ? loyal : null,
      },
    });
    enriched += upd.count;
  }

  console.log(`\nKaufland: ${r.offers} offers (${r.created} new, ${r.flagged} flagged), ${enriched} with promo/loyalty data.`);
  await prisma.$disconnect();
}

// Only run when invoked directly — the parser functions above are imported by the fixture
// tests, and importing a module must never trigger a live scrape.
const invokedDirectly = process.argv[1] ? process.argv[1].replace(/\\/g, "/").endsWith("scrape-kaufland.ts") : false;
if (invokedDirectly) {
  main().catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
}
