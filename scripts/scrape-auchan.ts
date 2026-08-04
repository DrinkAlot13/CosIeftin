// REAL scraper: Auchan (auchan.ro runs on VTEX). Uses VTEX's public catalog API
// (/api/catalog_system/pub/products/search — the same endpoint the storefront uses;
// not disallowed by robots.txt, which only blocks /busca/ and query-param page URLs).
//
// Polite by design: one small query per pre-set item, rate-limited, browser UA.
// For each item it picks the size-compatible (and brand-matching, if branded) result,
// then writes a REAL offer onto that canonical product.
//
// Run: npm run scrape:auchan   (requires the catalog to be seeded: npm run setup)

import { ITEMS, type ItemDef } from "../src/data/catalog";
import { prisma } from "../src/lib/db";
import { parseSize } from "../src/lib/ingest-core";
import { normalizeText } from "../src/lib/matching";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const BASE = "https://www.auchan.ro";
const DELAY_MS = 1500; // be gentle

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Search terms from an item name: drop diacritics, numbers, and unit words. */
function deriveQuery(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9%.,-]+/)
    .filter(Boolean)
    .filter((t) => !/\d/.test(t) && !["l", "ml", "kg", "g", "buc", "role", "rola", "pl", "plicuri", "set"].includes(t))
    .join(" ")
    .trim();
}

type VtexResult = {
  productName: string;
  brand: string;
  linkText: string;
  items: { ean: string; images?: { imageUrl: string }[]; sellers: { commertialOffer: { Price: number; IsAvailable: boolean } }[] }[];
};

type Candidate = { name: string; brand: string; ean: string; price: number; available: boolean; url: string; image: string | null };

async function searchAuchan(query: string): Promise<Candidate[]> {
  const url = `${BASE}/api/catalog_system/pub/products/search?ft=${encodeURIComponent(query)}&_from=0&_to=12`;
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json", "accept-language": "ro-RO" } });
  if (!res.ok && res.status !== 206) throw new Error(`status ${res.status}`);
  const data = (await res.json()) as VtexResult[];
  return data.map((p) => {
    const it = p.items?.[0];
    const off = it?.sellers?.[0]?.commertialOffer;
    return {
      name: p.productName,
      brand: p.brand ?? "",
      ean: it?.ean ?? "",
      price: off?.Price ?? 0,
      available: !!off?.IsAvailable,
      url: `${BASE}/${p.linkText}/p`,
      image: it?.images?.[0]?.imageUrl ?? null,
    };
  });
}

/** Choose the best Auchan product for one of our pre-set items. */
function pickBest(item: ItemDef, cands: Candidate[]): Candidate | null {
  const head = normalizeText(item.name).split(" ")[0]; // head noun, e.g. "lapte", "ulei"
  const sizeOk = cands.filter((c) => {
    if (normalizeText(c.name).split(" ")[0] !== head) return false; // same product type
    const s = parseSize(c.name);
    return s && s.unit === item.unit && Math.abs(s.unitSize - item.unitSize) <= item.unitSize * 0.06 + 1e-9;
  });
  let pool = sizeOk;
  if (item.brand) {
    const nb = normalizeText(item.brand);
    const branded = pool.filter((c) => normalizeText(c.brand).includes(nb) || normalizeText(c.name).includes(nb));
    if (branded.length === 0) return null; // want that brand specifically
    pool = branded;
  }
  if (pool.length === 0) return null;
  const priced = pool.filter((c) => c.price > 0);
  if (priced.length === 0) return null;
  const avail = priced.filter((c) => c.available);
  const finalPool = avail.length > 0 ? avail : priced;
  return finalPool.reduce((a, b) => (b.price < a.price ? b : a));
}

async function main() {
  const merchant = await prisma.merchant.upsert({
    where: { slug: "auchan" },
    update: { active: true },
    create: { slug: "auchan", name: "Auchan", websiteUrl: BASE, color: "#eda100" },
  });

  // Clear Auchan's sample offers so only REAL prices remain.
  await prisma.priceHistory.deleteMany({ where: { offer: { merchantId: merchant.id } } });
  await prisma.offer.deleteMany({ where: { merchantId: merchant.id } });

  let matched = 0;
  let attempted = 0;
  for (const item of ITEMS) {
    attempted++;
    const query = deriveQuery(item.name);
    try {
      const cands = await searchAuchan(query);
      const best = pickBest(item, cands);
      if (best) {
        const product = await prisma.product.findUnique({ where: { slug: item.slug } });
        if (product) {
          // enrich the catalog with the real EAN if we don't have one
          if (best.ean && !product.ean) {
            await prisma.product.update({ where: { id: product.id }, data: { ean: best.ean } }).catch(() => {});
          }
          if (best.image && !product.image) {
            await prisma.product.update({ where: { id: product.id }, data: { image: best.image } }).catch(() => {});
          }
          const ppu = item.unitSize > 0 ? best.price / item.unitSize : best.price;
          const offer = await prisma.offer.create({
            data: {
              productId: product.id,
              merchantId: merchant.id,
              price: best.price,
              pricePerUnit: ppu,
              packLabel: item.packLabel,
              availability: best.available ? "in stock" : "out of stock",
              url: best.url,
              currency: "RON",
              matchedBy: "scraper",
            },
          });
          await prisma.priceHistory.create({ data: { offerId: offer.id, price: best.price } });
          matched++;
          console.log(`  ✓ ${item.name.padEnd(34)} -> ${best.price} lei  (${best.name})`);
        }
      } else {
        console.log(`  · ${item.name.padEnd(34)} -> fără potrivire (q="${query}")`);
      }
    } catch (e) {
      console.log(`  ! ${item.name.padEnd(34)} -> eroare: ${(e as Error).message}`);
    }
    await sleep(DELAY_MS);
  }

  console.log(`\nAuchan: ${matched}/${attempted} produse cu preț real ingerate.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
