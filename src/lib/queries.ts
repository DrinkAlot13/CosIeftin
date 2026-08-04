import { prisma } from "@/lib/db";
import { jaccard, levenshtein, normalizeText, tokenize } from "@/lib/matching";
import { buildDailyLowSeries, dropPercent, summarize } from "@/lib/pricing";

const activeInclude = { where: { merchant: { active: true } }, include: { merchant: true } } as const;

export async function getMenuCategories() {
  return prisma.category.findMany({ orderBy: { id: "asc" } });
}
export type MenuCategory = Awaited<ReturnType<typeof getMenuCategories>>[number];

/** Add headline price + lowest price-per-unit to a product's offers. */
function decorate<T extends { offers: { price: number; availability: string; pricePerUnit: number }[] }>(products: T[]) {
  return products.map((p) => {
    const inStock = p.offers.filter((o) => o.availability === "in stock");
    const pool = inStock.length > 0 ? inStock : p.offers;
    const unitLowest = pool.length > 0 ? Math.min(...pool.map((o) => o.pricePerUnit || 0)) : 0;
    return { ...p, summary: summarize(p.offers), unitLowest };
  });
}

export type SortKey = "price-asc" | "unit-asc" | "name";

export async function getCategoryPage(slug: string, sort: SortKey = "unit-asc") {
  const category = await prisma.category.findUnique({ where: { slug } });
  if (!category) return null;
  const products = await prisma.product.findMany({
    where: { categoryId: category.id },
    include: { offers: activeInclude, category: true },
  });
  const decorated = decorate(products).filter((p) => p.summary.offerCount > 0);
  decorated.sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name, "ro");
    if (sort === "price-asc") return a.summary.lowest - b.summary.lowest;
    return a.unitLowest - b.unitLowest;
  });
  return { category, products: decorated };
}

export async function getItemPage(slug: string) {
  const product = await prisma.product.findUnique({
    where: { slug },
    include: {
      category: true,
      offers: { where: { merchant: { active: true } }, include: { merchant: true, history: { orderBy: { recordedAt: "asc" } } } },
    },
  });
  if (!product) return null;
  const offers = [...product.offers].sort((a, b) => a.price - b.price);
  const summary = summarize(offers);
  const series = buildDailyLowSeries(offers);
  const inStock = offers.filter((o) => o.availability === "in stock");
  const bestOffer = inStock[0] ?? offers[0] ?? null;
  return { product, offers, summary, series, bestOffer };
}

export type ItemPage = NonNullable<Awaited<ReturnType<typeof getItemPage>>>;
export type OfferRow = ItemPage["offers"][number];

function typoScore(qTokens: Set<string>, tTokens: string[]): number {
  if (qTokens.size === 0) return 0;
  let sum = 0;
  for (const q of qTokens) {
    let best = 0;
    for (const t of tTokens) {
      const sim = 1 - levenshtein(q, t) / Math.max(q.length, t.length);
      if (sim > best) best = sim;
    }
    sum += best;
  }
  return sum / qTokens.size;
}

export async function searchProducts(query: string) {
  const q = query.trim();
  if (!q) return [];
  const products = await prisma.product.findMany({ include: { offers: activeInclude, category: true } });
  const nq = normalizeText(q);
  const qTokens = tokenize(q);
  const scored = products
    .map((p) => {
      const hay = normalizeText(`${p.brand ?? ""} ${p.name}`);
      const tTokens = [...tokenize(`${p.brand ?? ""} ${p.name}`)];
      let score = 0;
      if (hay.includes(nq)) score += 1;
      if (hay.startsWith(nq)) score += 0.3;
      score += jaccard(qTokens, new Set(tTokens)) * 0.8;
      score += typoScore(qTokens, tTokens) * 0.6;
      return { p, score };
    })
    .filter((x) => x.score >= 0.35)
    .sort((a, b) => b.score - a.score);
  return decorate(scored.map((x) => x.p)).filter((p) => p.summary.offerCount > 0);
}

export type ProductCardData = Awaited<ReturnType<typeof searchProducts>>[number];

export async function suggestProducts(query: string, limit = 6) {
  const results = await searchProducts(query);
  return results.slice(0, limit).map((p) => ({ slug: p.slug, name: p.name, brand: p.brand, lowest: p.summary.lowest }));
}

export async function getHomeSections() {
  const products = await prisma.product.findMany({
    include: { offers: { where: { merchant: { active: true } }, include: { merchant: true, history: { orderBy: { recordedAt: "asc" } } } }, category: true },
  });
  const decorated = products.map((p) => ({
    ...p,
    summary: summarize(p.offers),
    unitLowest: (() => {
      const inStock = p.offers.filter((o) => o.availability === "in stock");
      const pool = inStock.length > 0 ? inStock : p.offers;
      return pool.length > 0 ? Math.min(...pool.map((o) => o.pricePerUnit || 0)) : 0;
    })(),
    drop: dropPercent(buildDailyLowSeries(p.offers)),
  }));
  const featured = [...decorated].filter((p) => p.summary.offerCount > 0).slice(0, 8);
  const drops = [...decorated].filter((p) => p.drop > 2 && p.summary.offerCount >= 2).sort((a, b) => b.drop - a.drop).slice(0, 6);
  return { featured, drops };
}

export type HomeProduct = Awaited<ReturnType<typeof getHomeSections>>["featured"][number];

/** Products (with active offers) for a basket, by slug. */
export async function getBasketProducts(slugs: string[]) {
  if (slugs.length === 0) return [];
  return prisma.product.findMany({
    where: { slug: { in: slugs } },
    include: { offers: activeInclude },
  });
}

export async function countStats() {
  const [products, offers, chains] = await Promise.all([
    prisma.product.count({ where: { offers: { some: {} } } }),
    prisma.offer.count(),
    prisma.merchant.count({ where: { offers: { some: {} } } }),
  ]);
  return { products, offers, chains };
}

export async function getAdminStats() {
  const [products, offers, chains] = await Promise.all([
    prisma.product.count(),
    prisma.offer.count(),
    prisma.merchant.count(),
  ]);
  const merchantRows = await prisma.merchant.findMany({
    include: { _count: { select: { offers: true } } },
    orderBy: { name: "asc" },
  });
  const newest = await prisma.offer.findFirst({ orderBy: { lastSeen: "desc" }, select: { lastSeen: true } });
  return { products, offers, chains, merchantRows, lastUpdated: newest?.lastSeen ?? null };
}
