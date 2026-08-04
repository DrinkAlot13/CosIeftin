// REAL scraper: Freshful (freshful.ro, eMAG — a Next.js app). Product data is
// server-rendered into __NEXT_DATA__ on category pages (allowed by robots; the
// /api/v2/shop JSON API is robots-DISALLOWED, so we parse the page instead).
//
// Fetches a set of department pages, pools the products, and matches our pre-set
// items (head-noun + size + brand). Polite: ~10 requests, rate-limited, browser UA.
//
// Run: npm run scrape:freshful   (after: npm run setup)

import { ITEMS, type ItemDef } from "../src/data/catalog";
import { prisma } from "../src/lib/db";
import { parseSize } from "../src/lib/ingest-core";
import { normalizeText } from "../src/lib/matching";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const BASE = "https://www.freshful.ro";
const DELAY_MS = 1500;

// Departments covering our pre-set items.
const DEPARTMENTS = [
  "1-brutarie-si-patiserie",
  "2-carne-si-peste",
  "3-fructe-si-legume",
  "4-lactate-branzeturi-si-oua",
  "5-mezeluri-si-ready-to-cook",
  "7-bauturi-si-tutun",
  "8-ceva-sarat",
  "9-ceva-dulce",
  "11-cosmetice-si-ingrijire-personala",
  "13-detergent-si-igienizare",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Candidate = { code: string; name: string; brand: string; price: number; available: boolean; url: string; image: string | null };

function firstUrl(o: unknown): string | null {
  if (typeof o === "string") return o.startsWith("http") ? o : null;
  if (o && typeof o === "object") for (const v of Object.values(o)) { const u = firstUrl(v); if (u) return u; }
  return null;
}

async function fetchDept(slug: string): Promise<Candidate[]> {
  const res = await fetch(`${BASE}/c/${slug}`, { headers: { "user-agent": UA, "accept-language": "ro-RO" } });
  if (!res.ok) throw new Error(`status ${res.status}`);
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return [];
  const data = JSON.parse(m[1]);
  const out: Candidate[] = [];
  (function walk(o: any, d: number) {
    if (!o || typeof o !== "object" || d > 18) return;
    if (Array.isArray(o)) { for (const x of o) walk(x, d + 1); return; }
    if (typeof o.name === "string" && typeof o.price === "number" && "isAvailable" in o) {
      out.push({
        code: String(o.code ?? o.sku ?? o.slug ?? o.name),
        name: o.name,
        brand: o.brand ?? "",
        price: o.price,
        available: !!o.isAvailable,
        url: o.slug ? `${BASE}/p/${o.slug}` : BASE,
        image: firstUrl(o.image),
      });
    }
    for (const k of Object.keys(o)) walk(o[k], d + 1);
  })(data.props?.pageProps ?? data, 0);
  return out;
}

function pickBest(item: ItemDef, cands: Candidate[]): Candidate | null {
  const head = normalizeText(item.name).split(" ")[0];
  const sizeOk = cands.filter((c) => {
    if (normalizeText(c.name).split(" ")[0] !== head) return false;
    const s = parseSize(c.name);
    return s && s.unit === item.unit && Math.abs(s.unitSize - item.unitSize) <= item.unitSize * 0.06 + 1e-9;
  });
  let pool = sizeOk;
  if (item.brand) {
    const nb = normalizeText(item.brand);
    const branded = pool.filter((c) => normalizeText(c.brand).includes(nb) || normalizeText(c.name).includes(nb));
    if (branded.length === 0) return null;
    pool = branded;
  }
  const priced = pool.filter((c) => c.price > 0);
  if (priced.length === 0) return null;
  const avail = priced.filter((c) => c.available);
  const finalPool = avail.length > 0 ? avail : priced;
  return finalPool.reduce((a, b) => (b.price < a.price ? b : a));
}

async function main() {
  const merchant = await prisma.merchant.upsert({
    where: { slug: "freshful" },
    update: { active: true, name: "Freshful", websiteUrl: BASE, color: "#00a651" },
    create: { slug: "freshful", name: "Freshful", websiteUrl: BASE, color: "#00a651" },
  });

  // Pool products from all relevant departments.
  const pool: Candidate[] = [];
  const byCode = new Set<string>();
  for (const dep of DEPARTMENTS) {
    try {
      const cands = await fetchDept(dep);
      for (const c of cands) if (!byCode.has(c.code)) { byCode.add(c.code); pool.push(c); }
      console.log(`  ${dep.padEnd(38)} +${cands.length} (pool ${pool.length})`);
    } catch (e) {
      console.log(`  ${dep.padEnd(38)} eroare: ${(e as Error).message}`);
    }
    await sleep(DELAY_MS);
  }

  // Clear Freshful's previous offers, then attach real ones.
  await prisma.priceHistory.deleteMany({ where: { offer: { merchantId: merchant.id } } });
  await prisma.offer.deleteMany({ where: { merchantId: merchant.id } });

  let matched = 0;
  for (const item of ITEMS) {
    const best = pickBest(item, pool);
    if (!best) { console.log(`  · ${item.name.padEnd(34)} -> fără potrivire`); continue; }
    const product = await prisma.product.findUnique({ where: { slug: item.slug } });
    if (!product) continue;
    if (best.image && !product.image) await prisma.product.update({ where: { id: product.id }, data: { image: best.image } }).catch(() => {});
    const ppu = item.unitSize > 0 ? best.price / item.unitSize : best.price;
    const offer = await prisma.offer.create({
      data: {
        productId: product.id, merchantId: merchant.id, price: best.price, pricePerUnit: ppu,
        packLabel: item.packLabel, availability: best.available ? "in stock" : "out of stock",
        url: best.url, currency: "RON", matchedBy: "scraper",
      },
    });
    await prisma.priceHistory.create({ data: { offerId: offer.id, price: best.price } });
    matched++;
    console.log(`  ✓ ${item.name.padEnd(34)} -> ${best.price} lei  (${best.name})`);
  }

  console.log(`\nFreshful: ${matched}/${ITEMS.length} produse cu preț real ingerate.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
