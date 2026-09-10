// GET /api/v1/search?q= — the existing ranker, as JSON. See docs/API.md §3.5.
import { type NextRequest } from "next/server";
import { apiError, apiGuard, apiOk, apiPreflight } from "@/lib/api/respond";
import { readParams } from "@/lib/api/schema";
import { SEARCH_PARAMS } from "@/lib/api/routes";
import { searchCatalog } from "@/lib/search/search";
import { getSearchableCatalog } from "@/lib/search/index-cache";
import { comparisonOf } from "@/lib/api/serialize";
import { prisma } from "@/lib/db";
import { MAX_DISPLAY_AGE_DAYS } from "@/lib/pricing";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return apiPreflight("public-get");
}

export async function GET(req: NextRequest) {
  const g = apiGuard("apiRead", req);
  if (g.limited) return g.limited;
  const opts = { cache: { sMaxAge: 3600, swr: 86_400 }, rateLimit: g.budget };

  const p = readParams<{ q: string; limit: number; section: string }>(SEARCH_PARAMS, (n) => req.nextUrl.searchParams.get(n));
  if (!p.ok) return apiError("bad_request", p.message, { field: p.field }, opts);

  const { catalog } = await getSearchableCatalog();
  const out = searchCatalog(p.value.q, catalog);
  const top = out.results.slice(0, p.value.limit);

  // ── THE RANKER'S CACHE HOLDS NO SLUG AND NO PRICE, by design — it is a scoring index, not a
  // render payload. So the top N are hydrated here, in ONE query, rather than the cache being
  // widened for a caller it was not built for.
  const ids = top.map((r) => (r.item as { id: number }).id);
  const rows = ids.length
    ? await prisma.product.findMany({
        where: { id: { in: ids } },
        select: {
          id: true, slug: true, name: true, brand: true, unit: true, unitSize: true, image: true,
          offers: {
            where: {
              merchant: { active: true }, flagged: false, isStale: false, availability: "in stock",
              NOT: { priceSource: "DELIVERY_PLATFORM" },
              lastObservedAt: { gte: new Date(Date.now() - MAX_DISPLAY_AGE_DAYS * 86_400_000) },
            },
            select: { priceBani: true, price: true, merchant: { select: { slug: true } } },
          },
        },
      })
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));

  return apiOk({
    query: p.value.q,
    // `brand-miss` is PRESERVED rather than flattened into an empty result. It means "we have the
    // category but not that brand", which is the one thing that lets a client say something
    // useful instead of showing nothing.
    kind: out.kind,
    missing: out.kind === "brand-miss" ? out.missing : [],
    results: top.flatMap((r) => {
      const row = byId.get((r.item as { id: number }).id);
      if (!row) return [];
      const prices = row.offers.map((o) => o.priceBani ?? Math.round(o.price * 100));
      return [{
        product: {
          slug: row.slug, name: row.name, brand: row.brand,
          unit: row.unit, unitSize: row.unitSize, image: row.image,
        },
        comparison: comparisonOf(row.offers.map((o) => ({ merchant: { slug: o.merchant.slug } }))),
        lowestBani: prices.length ? Math.min(...prices) : null,
        score: Number(r.score.toFixed(3)),
      }];
    }),
  }, opts);
}
