// REAL scraper + CATALOG MASTER: Auchan (VTEX). Browses the category tree via the
// public catalog API and builds the canonical product catalog (name, brand, unit,
// size, EAN, image, category) that every other store matches onto — plus Auchan's
// own offers. This is what expands coverage far beyond a hand-written item list.
//
// Run: npm run scrape:auchan

import { prisma } from "../src/lib/db";
import { parseSize } from "../src/lib/ingest-core";
import { baniToLei, leiToBaniExact, perUnitBaniOrNull } from "../src/lib/price/parsePrice";
import { slugify } from "../src/lib/scrape-util";

// No request may hang forever. `fetch` waits on a stalled connection indefinitely, and one
// such socket in the DCNeu detail pass stopped the whole nightly dead at 5,500 of 6,034
// products with the process using zero CPU — and because scrape-all runs stores in sequence,
// the three stores queued behind it never ran at all. Nothing crashed, so nothing reported it.
const REQUEST_TIMEOUT_MS = 20_000;

const BASE = "https://www.auchan.ro";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const MAX_PAGES = 8; // 50 products/page (breaks early when a page comes back empty)
const DELAY_MS = 700;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Auchan VTEX subcategory id -> our category slug. NOTE: VTEX gates single-segment
// category browsing (fq=C:2030000 -> []), so we query the FULL PATH fq=C:{top}/{sub}
// (top = the 1e6-rounded parent id, added automatically in browse()).
const CATS: { id: number; slug: string }[] = [
  { id: 2030000, slug: "lactate" }, { id: 2050000, slug: "lactate" }, { id: 2020000, slug: "lactate" },
  { id: 2010000, slug: "mezeluri" }, { id: 2040000, slug: "mezeluri" }, { id: 2060000, slug: "mezeluri" },
  { id: 4030000, slug: "panificatie" }, { id: 4040000, slug: "panificatie" }, { id: 4010000, slug: "panificatie" }, { id: 4050000, slug: "panificatie" },
  { id: 1020000, slug: "legume-fructe" }, { id: 1040000, slug: "legume-fructe" }, { id: 1050000, slug: "legume-fructe" }, { id: 1030000, slug: "legume-fructe" },
  { id: 5010000, slug: "bauturi" }, { id: 5060000, slug: "bauturi" }, { id: 5050000, slug: "bauturi" }, { id: 5030000, slug: "bauturi" }, { id: 5040000, slug: "bauturi" }, { id: 3200000, slug: "bauturi" },
  { id: 3010000, slug: "bacanie" }, { id: 3130000, slug: "bacanie" }, { id: 3140000, slug: "bacanie" }, { id: 3150000, slug: "bacanie" },
  { id: 3160000, slug: "bacanie" }, { id: 3080000, slug: "bacanie" }, { id: 3190000, slug: "bacanie" }, { id: 3220000, slug: "bacanie" },
  { id: 3090000, slug: "bacanie" }, { id: 3050000, slug: "bacanie" }, { id: 3020000, slug: "bacanie" }, { id: 3040000, slug: "bacanie" },
  { id: 3060000, slug: "bacanie" }, { id: 3070000, slug: "bacanie" }, { id: 3170000, slug: "bacanie" }, { id: 3210000, slug: "bacanie" },
  { id: 7040000, slug: "menaj" }, { id: 7070000, slug: "menaj" }, { id: 7080000, slug: "menaj" }, { id: 7090000, slug: "menaj" },
  { id: 7050000, slug: "menaj" }, { id: 8020000, slug: "menaj" }, { id: 8050000, slug: "menaj" }, { id: 8070000, slug: "menaj" },
];

async function browse(catId: number, from: number, to: number) {
  const top = Math.floor(catId / 1_000_000) * 1_000_000;
  const url = `${BASE}/api/catalog_system/pub/products/search?fq=C:${top}/${catId}&_from=${from}&_to=${to}`;
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json", "accept-language": "ro-RO" }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok && res.status !== 206) throw new Error(`status ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? (data as any[]) : [];
}

async function main() {
  const merchant = await prisma.merchant.upsert({
    where: { slug: "auchan" },
    update: { active: true, name: "Auchan", websiteUrl: BASE, color: "#eda100" },
    create: { slug: "auchan", name: "Auchan", websiteUrl: BASE, color: "#eda100" },
  });
  const catMap = new Map((await prisma.category.findMany({ select: { slug: true, id: true } })).map((c) => [c.slug, c.id]));

  // How many Auchan offers a shopper can act on RIGHT NOW. This is the drop-guard baseline,
  // and it is read before anything is written.
  const previousLive = await prisma.offer.count({
    where: { merchantId: merchant.id, availability: "in stock" },
  });

  // NOTE: this used to mark every Auchan offer "out of stock" here, before the scrape had
  // fetched a single page — and then had no drop guard at all. So an Auchan that was blocked
  // or redesigned would take all 9,000+ of its offers out of stock and there was nothing to
  // stop it. Auchan is the CATALOG MASTER and the largest merchant; that is the worst place in
  // the system for an unguarded wipe. Mega Image was blocked tonight and its guard saved it.
  //
  // Now nothing is marked stale up front. Offers seen this run are upserted as they arrive,
  // and only at the end — and only if the run looks complete — are the unseen ones retired.
  const seenProductIds = new Set<number>();
  const seen = new Set<string>();
  let offers = 0;
  for (const cat of CATS) {
    const categoryId = catMap.get(cat.slug) ?? null;
    let catCount = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      let data: any[];
      try { data = await browse(cat.id, page * 50, page * 50 + 49); } catch { break; }
      if (!Array.isArray(data) || data.length === 0) break;
      for (const p of data) {
        const it = p.items?.[0];
        const price = it?.sellers?.[0]?.commertialOffer?.Price ?? 0;
        if (price <= 0) continue;
        const ean = String(it?.ean ?? "").trim();
        const name = String(p.productName ?? "").trim();
        if (!name) continue;
        const brand = p.brand || null;
        const parsed = parseSize(name);
        const unit = parsed?.unit ?? "buc";
        const unitSize = parsed?.unitSize ?? 1;
        const image = it?.images?.[0]?.imageUrl ?? null;
        const url = `${BASE}/${p.linkText}/p`;
        const available = !!it?.sellers?.[0]?.commertialOffer?.IsAvailable;

        const key = ean || `${slugify(name)}|${unitSize}${unit}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const baseSlug = slugify(name) || "produs";
        const slug = ean ? `${baseSlug}-${ean}` : `${baseSlug}-${Math.round(unitSize * 1000)}${unit}`;
        const product = ean
          ? await prisma.product.upsert({ where: { ean }, update: { image: image ?? undefined, ...(parsed ? { unit, unitSize } : {}) }, create: { slug, name, brand, ean, unit, unitSize, image, categoryId } }).catch(() => null)
          : await prisma.product.upsert({ where: { slug }, update: { image: image ?? undefined, ...(parsed ? { unit, unitSize } : {}) }, create: { slug, name, brand, unit, unitSize, image, categoryId } }).catch(() => null);
        if (!product) continue;

        // Bani is the written value; the float is derived from it. Auchan already set both,
        // but it derived bani FROM the float, which is the direction that lets them drift.
        const priceBani = leiToBaniExact(price);
        const priceLei = baniToLei(priceBani);
        const ppu = unitSize > 0 ? priceLei / unitSize : priceLei;
        const ppuBani = perUnitBaniOrNull(priceLei, unitSize);
        // Auchan is the CATALOG MASTER: the product is created from this very row, so the
        // product↔offer link is exact by construction rather than inferred. Recording that
        // as a real reason + score 1 (instead of the bare "scraper" with no score) is what
        // lets the audit assert "no live offer without a confidence score".
        const prev = await prisma.offer.findUnique({
          where: { productId_merchantId: { productId: product.id, merchantId: merchant.id } },
          select: { id: true, price: true },
        });
        const provenance = {
          productUrl: url || null,
          rawPriceText: String(price),
          lastSeenAt: new Date(),
          isStale: false,
          matchedBy: "catalog-master",
          matchScore: 1,
        };
        const offer = await prisma.offer.upsert({
          where: { productId_merchantId: { productId: product.id, merchantId: merchant.id } },
          update: { price: priceLei, priceBani, pricePerUnit: ppu, pricePerUnitBani: ppuBani, availability: available ? "in stock" : "out of stock", url, lastSeen: new Date(), ...provenance },
          create: { productId: product.id, merchantId: merchant.id, price: priceLei, priceBani, pricePerUnit: ppu, pricePerUnitBani: ppuBani, availability: available ? "in stock" : "out of stock", url, currency: "RON", ...provenance },
        });
        // Append a history point only when the price actually moved — writing one per run
        // per offer inflates the table ~20-50x for no information (see CLAUDE.md).
        if (!prev || Math.abs(prev.price - price) > 1e-9) {
          await prisma.priceHistory.create({ data: { offerId: offer.id, price: priceLei, priceBani } });
        }
        seenProductIds.add(product.id);
        offers++;
        catCount++;
      }
      await sleep(DELAY_MS);
    }
    console.log(`  ${cat.slug.padEnd(14)} C:${cat.id}  +${catCount}  (offers ${offers})`);
  }

  // DROP-GUARD. A collapsed run means the site changed or blocked us, not that Auchan stopped
  // selling nine thousand products. Retiring the unseen offers is the destructive step, so it
  // is the one thing withheld when the run does not look complete. The offers this run DID see
  // were already written — they are real observations and there is no reason to discard them.
  if (previousLive > 0 && offers < previousLive * 0.6) {
    console.error(
      `[auchan] run refused to retire stale offers: ${offers} scraped < 60% of ${previousLive} ` +
      `previously in stock. The ${offers} offers seen this run were written; the rest keep ` +
      `their existing state instead of being marked out of stock.`,
    );
    const n = await prisma.product.count();
    console.log(`\nAuchan (catalog master): ${offers} offers, run INCOMPLETE. Catalog now ${n} products.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  // Retire only what this run did not see.
  const retired = await prisma.offer.updateMany({
    where: { merchantId: merchant.id, productId: { notIn: [...seenProductIds] } },
    data: { availability: "out of stock" },
  });

  const products = await prisma.product.count();
  console.log(`\nAuchan (catalog master): ${offers} offers, ${retired.count} retired. Catalog now ${products} products.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
