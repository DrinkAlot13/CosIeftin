// GET /api/v1/meta — catalog size, merchants, freshness, comparability. See docs/API.md §3.7.
//
// This endpoint exists so a client can be HONEST without doing arithmetic. In particular
// `comparability`: any client tempted to say "we compare 16 shops" can read here that 89% of
// priced products have exactly one, and phrase itself accordingly.
import { type NextRequest } from "next/server";
import { apiGuard, apiOk, apiPreflight } from "@/lib/api/respond";
import { prisma } from "@/lib/db";
import { MAX_DISPLAY_AGE_DAYS } from "@/lib/pricing";
import { nullProductUrlIsExpected } from "@/lib/source-capabilities";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return apiPreflight("public-get");
}

export async function GET(req: NextRequest) {
  const g = apiGuard("apiRead", req);
  if (g.limited) return g.limited;
  const opts = { cache: { sMaxAge: 900, swr: 3600 }, rateLimit: g.budget };

  const cutoff = new Date(Date.now() - MAX_DISPLAY_AGE_DAYS * 86_400_000);
  const live = { merchant: { active: true }, flagged: false, isStale: false, availability: "in stock", lastObservedAt: { gte: cutoff } } as const;

  const [products, liveOffers, merchants] = await Promise.all([
    prisma.product.count(),
    prisma.offer.count({ where: live }),
    prisma.merchant.findMany({
      where: { active: true },
      select: {
        slug: true, name: true, storeType: true,
        offers: { where: live, select: { lastObservedAt: true, loyaltyPriceBani: true, sku: true }, orderBy: { lastObservedAt: "desc" } },
      },
      orderBy: { name: "asc" },
    }),
  ]);

  // Comparability, computed from shop COUNTS rather than remembered. The headline number this
  // project keeps re-measuring: how many priced products are a comparison at all.
  const priced = await prisma.product.findMany({
    where: { section: "grocery", offers: { some: live } },
    select: { offers: { where: live, select: { merchantId: true } } },
  });
  const shops = priced.map((p) => new Set(p.offers.map((o) => o.merchantId)).size);
  const comparable = shops.filter((n) => n >= 2).length;

  return apiOk({
    catalog: {
      products,
      pricedProducts: priced.length,
      liveOffers,
      maxDisplayAgeDays: MAX_DISPLAY_AGE_DAYS,
    },
    merchants: merchants.map((m) => ({
      slug: m.slug,
      name: m.name,
      storeType: m.storeType ?? null,
      liveOffers: m.offers.length,
      lastObservedAt: m.offers[0]?.lastObservedAt?.toISOString() ?? null,
      // Declared, not inferred from a null count — a merchant that genuinely publishes no
      // per-product page is a known shape, not a gap. See lib/source-capabilities.ts.
      publishesDeepLinks: !nullProductUrlIsExpected(m.slug),
      publishesLoyaltyPrice: m.offers.some((o) => o.loyaltyPriceBani != null),
      storesSku: m.offers.some((o) => o.sku != null && o.sku !== ""),
    })),
    comparability: {
      grocery: {
        comparable: priced.length ? Number((comparable / priced.length).toFixed(4)) : null,
        singleShop: priced.length ? Number(((priced.length - comparable) / priced.length).toFixed(4)) : null,
        note: "Majoritatea produselor cu preț au un singur magazin. Un client care spune „comparăm 16 magazine” spune ceva fals despre cele mai multe produse.",
      },
    },
    apiVersion: "v1",
    deprecation: null,
  }, opts);
}
