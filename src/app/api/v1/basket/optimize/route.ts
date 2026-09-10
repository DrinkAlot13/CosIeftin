// POST /api/v1/basket/optimize — the optimizer, as a contract. See docs/API.md §3.6.
//
// The one v1 endpoint that is a POST and the one with a restricted CORS policy: it is by far the
// most expensive call (up to 100 products, every offer, substitution resolution, per-store
// totals), and an open one is a free compute service.
//
// It calls `optimizeBasket` — the SAME function `/lista` uses. A parallel implementation would
// eventually disagree with the website about which shop is cheaper, and the website would be the
// one people checked.
import { type NextRequest } from "next/server";
import { apiError, apiGuard, apiOk, apiPreflight } from "@/lib/api/respond";
import { prisma } from "@/lib/db";
import { optimizeBasket, type ProductForBasket } from "@/lib/basket";
import { MAX_DISPLAY_AGE_DAYS } from "@/lib/pricing";
import { formatBani } from "@/lib/price/parsePrice";

export const dynamic = "force-dynamic";

const MAX_ITEMS = 100;

export function OPTIONS() {
  return apiPreflight("restricted");
}

const lei = (n: number) => Math.round(n * 100);

export async function POST(req: NextRequest) {
  const g = apiGuard("apiOptimize", req, "restricted");
  if (g.limited) return g.limited;
  const opts = { cors: "restricted" as const, cache: { sMaxAge: 0, swr: 0 }, rateLimit: g.budget };

  const body = await req.json().catch(() => null);
  if (typeof body !== "object" || body === null) {
    return apiError("bad_request", "Corpul cererii trebuie să fie JSON.", {}, opts);
  }
  const raw = (body as { items?: unknown }).items;
  if (!Array.isArray(raw) || raw.length === 0) {
    return apiError("bad_request", "items este obligatoriu și trebuie să conțină cel puțin o linie.", { field: "items" }, opts);
  }
  if (raw.length > MAX_ITEMS) {
    return apiError("bad_request", `Maxim ${MAX_ITEMS} linii.`, { field: "items", max: MAX_ITEMS }, opts);
  }

  const wanted: { slug: string; qty: number }[] = [];
  for (const [i, it] of raw.entries()) {
    const slug = typeof (it as { slug?: unknown }).slug === "string" ? (it as { slug: string }).slug : null;
    const qtyRaw = (it as { qty?: unknown }).qty;
    const qty = qtyRaw === undefined ? 1 : Number(qtyRaw);
    if (!slug) return apiError("bad_request", `items[${i}].slug lipsește.`, { index: i }, opts);
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
      return apiError("bad_request", `items[${i}].qty trebuie să fie un întreg între 1 și 99.`, { index: i }, opts);
    }
    wanted.push({ slug, qty });
  }

  const o = (body as { options?: Record<string, unknown> }).options ?? {};
  const includeDeliveryPlatform = o.includeDeliveryPlatform === true;
  const useLoyalty = o.useLoyalty === true;
  const stores = Array.isArray(o.stores) ? (o.stores as unknown[]).filter((s): s is string => typeof s === "string") : null;

  const cutoff = new Date(Date.now() - MAX_DISPLAY_AGE_DAYS * 86_400_000);
  const products = await prisma.product.findMany({
    where: { slug: { in: wanted.map((w) => w.slug) } },
    select: {
      id: true, slug: true, name: true, unit: true,
      offers: {
        where: {
          merchant: { active: true, ...(stores ? { slug: { in: stores } } : {}) },
          flagged: false,
          lastObservedAt: { gte: cutoff },
          ...(includeDeliveryPlatform ? {} : { NOT: { priceSource: "DELIVERY_PLATFORM" } }),
        },
        select: {
          price: true, priceBani: true, availability: true, isStale: true, flagged: true,
          priceSource: true, loyaltyPrice: true, requiresLoyaltyCard: true,
          depositBani: true, containerCount: true, lastObservedAt: true,
          tiers: { select: { minQuantity: true, unitPriceBani: true, discountBp: true }, orderBy: { minQuantity: "asc" } },
          merchant: { select: { id: true, slug: true, name: true, color: true, storeType: true, deliveryFee: true, minOrder: true, freeDeliveryOver: true } },
        },
      },
    },
  });

  const bySlug = new Map(products.map((p) => [p.slug, p]));
  const missing = wanted.filter((w) => !bySlug.has(w.slug));

  const forBasket: ProductForBasket[] = products.map((p) => ({
    id: p.id, slug: p.slug, name: p.name, unit: p.unit ?? "buc",
    offers: p.offers as ProductForBasket["offers"],
  }));
  const items = wanted.flatMap((w) => {
    const p = bySlug.get(w.slug);
    return p ? [{ productId: p.id, qty: w.qty }] : [];
  });

  const r = optimizeBasket(forBasket, items, { useLoyalty });

  return apiOk({
    storeTotals: r.storeTotals.map((s) => ({
      merchant: { slug: s.slug, name: s.name, storeType: s.storeType },
      goodsBani: lei(s.subtotal),
      deliveryBani: lei(s.deliveryFee),
      totalBani: lei(s.total),
      total: formatBani(lei(s.total)),
      itemsFound: s.itemsFound,
      itemsMissing: s.missing,
      // A card price is not a price everyone can pay, so a total that used one says so.
      usesLoyalty: s.usesLoyalty,
      belowMinOrder: s.belowMinOrder,
      minOrderBani: s.minOrder == null ? null : lei(s.minOrder),
      needForMinOrderBani: s.needForMinOrder == null ? null : lei(s.needForMinOrder),
      needForFreeDeliveryBani: s.needForFreeDelivery == null ? null : lei(s.needForFreeDelivery),
      priceSource: s.priceSource,
    })),
    split: { totalBani: lei(r.splitTotal), goodsBani: lei(r.splitGoods), deliveryBani: lei(r.splitDelivery) },
    bestComplete: r.bestComplete
      ? { merchant: r.bestComplete.slug, totalBani: lei(r.bestComplete.total) }
      : null,
    perItem: r.perItem.map((i) => ({
      slug: i.slug,
      name: i.name,
      qty: i.qty,
      // `cheapest` is null when nothing in the selected shops could price this line. That is a
      // FOUND product with NO price, which is a different answer from a product we do not carry
      // — the `unavailable` array below holds the second kind.
      chosen: i.cheapest
        ? {
            merchant: i.cheapest.merchantSlug,
            merchantName: i.cheapest.merchantName,
            unitPriceBani: lei(i.cheapest.unitPrice),
            linePriceBani: lei(i.cheapest.linePrice),
            // A card price is not one everyone can pay. Flagged per line, not only per store.
            requiresLoyaltyCard: i.cheapest.loyalty,
            priceSource: i.cheapest.priceSource,
            depositBani: i.cheapest.depositLine != null ? lei(i.cheapest.depositLine) : null,
            bulkTier: i.cheapest.bulk
              ? { fromQty: i.cheapest.bulk.fromQty, unitPriceBani: lei(i.cheapest.bulk.unitPrice), savedOnLineBani: lei(i.cheapest.bulk.savedOnLine) }
              : null,
            // Only ever present when the NEXT rung costs less in total. Suggesting "buy two more
            // to save four bani a unit" is an upsell, and a price-comparison API must not carry
            // one — the optimizer already refuses to compute it, and this passes that refusal on.
            nextRung: i.cheapest.nextRung
              ? { addUnits: i.cheapest.nextRung.addUnits, atQty: i.cheapest.nextRung.atQty, newUnitPriceBani: lei(i.cheapest.nextRung.newUnitPrice), savesTotalBani: lei(i.cheapest.nextRung.savesTotal) }
              : null,
          }
        : null,
      unpriced: i.cheapest === null,
    })),
    // ── A LINE WE COULD NOT PRICE IS ITS OWN ANSWER, never a silent omission. A basket that
    // quietly drops what it could not find and reports a total is understating the shop, and the
    // client has no way to notice. Two distinct kinds are kept apart:
    //   not-in-catalog  — we do not carry this slug at all
    //   no-current-price — we carry it, and nothing in the selected shops has a live price
    unavailable: [
      ...missing.map((m) => ({ slug: m.slug, reason: "not-in-catalog" as const })),
      ...r.perItem.filter((i) => i.cheapest === null).map((i) => ({ slug: i.slug, reason: "no-current-price" as const })),
    ],
  }, opts);
}
