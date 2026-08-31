// Basket optimizer v2 — the substitution-aware engine.
//
// Runs alongside the v1 route rather than replacing it: /lista still calls v1, so shipping
// this does not risk the live page. The UI moves over deliberately, not as a side effect.
//
// POST {
//   items: [{ slug, qty, mode?, requestedQuantity? }],
//   maxStores?, preferPrivateLabel?, allowedMerchantTypes?, requireAllItems?
// }
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { optimizeBasket, type MerchantInfo } from "@/lib/basket/optimize";
import type { ListLine, OfferLike, SubstitutionMode, UserContext } from "@/lib/substitution/resolve";
import { leiToBaniExact } from "@/lib/price/parsePrice";
import { parseQuantity } from "@/lib/units/parseQuantity";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const MODES: SubstitutionMode[] = ["EXACT", "SAME_BRAND", "EQUIVALENT", "CHEAPEST"];

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const raw = Array.isArray(body.items) ? body.items : [];
  const wanted = raw
    .map((r: { slug?: unknown; qty?: unknown; mode?: unknown; requestedQuantity?: unknown }) => ({
      slug: String(r.slug ?? ""),
      qty: Math.max(1, Math.min(99, Number(r.qty) || 1)),
      mode: (MODES.includes(r.mode as SubstitutionMode) ? r.mode : "EQUIVALENT") as SubstitutionMode,
      requestedQuantity: Number(r.requestedQuantity) > 0 ? Number(r.requestedQuantity) : null,
    }))
    .filter((r: { slug: string }) => r.slug);
  if (wanted.length === 0) return NextResponse.json({ error: "no items" }, { status: 400 });

  const slugs = [...new Set(wanted.map((w: { slug: string }) => w.slug))] as string[];
  const requested = await prisma.product.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true, equivalenceClassId: true } });
  const bySlug = new Map(requested.map((p) => [p.slug, p]));

  // Load every offer that could serve these lines: the requested products themselves plus
  // anything in the same equivalence class (that is what makes substitution possible).
  const classIds = [...new Set(requested.map((p) => p.equivalenceClassId).filter((x): x is number => x != null))];
  const offers = await prisma.offer.findMany({
    where: {
      OR: [
        { productId: { in: requested.map((p) => p.id) } },
        ...(classIds.length ? [{ product: { equivalenceClassId: { in: classIds } } }] : []),
      ],
      flagged: false,
    },
    select: {
      id: true, productId: true, merchantId: true, priceBani: true, price: true,
      availability: true, isStale: true, isExpired: true, promoValidTo: true,
      requiresLoyaltyCard: true, bulkTiers: true,
      product: { select: { id: true, name: true, brand: true, equivalenceClassId: true, unit: true, unitSize: true } },
      _count: { select: { anomalies: true } },
    },
    take: 5000,
  });

  const offerLikes: OfferLike[] = offers.map((o) => {
    // canonical pack quantity: G / ML / BUC
    const q = parseQuantity(o.product.name);
    const packQuantity = q ? q.value : o.product.unit === "buc" ? o.product.unitSize : o.product.unitSize * 1000;
    let tiers: { qty: number; priceBani: number }[] | undefined;
    if (o.bulkTiers) {
      try {
        const parsed = JSON.parse(o.bulkTiers) as { qty: number; price: number }[];
        tiers = parsed.map((t) => ({ qty: t.qty, priceBani: leiToBaniExact(t.price) }));
      } catch { /* malformed tiers are simply absent */ }
    }
    return {
      id: o.id, productId: o.productId, merchantId: o.merchantId,
      // priceBani is authoritative; fall back to the legacy float only until it is dropped
      priceBani: o.priceBani ?? leiToBaniExact(o.price),
      packQuantity: packQuantity > 0 ? packQuantity : 1,
      unit: q?.unit ?? (o.product.unit === "buc" ? "BUC" : o.product.unit === "kg" ? "G" : "ML"),
      availability: o.availability,
      isStale: o.isStale, isExpired: o.isExpired,
      hasUnresolvedAnomaly: o._count.anomalies > 0,
      requiresLoyaltyCard: o.requiresLoyaltyCard,
      bulkTiers: tiers,
      promoValidTo: o.promoValidTo,
      product: {
        id: o.product.id, name: o.product.name, brand: o.product.brand,
        equivalenceClassId: o.product.equivalenceClassId,
        // private label is inferred until ProductAttribute is populated
        isPrivateLabel: false,
      },
    };
  });

  const merchantRows = await prisma.merchant.findMany({
    where: { active: true },
    select: { id: true, slug: true, name: true, storeType: true, deliveryFee: true, freeDeliveryOver: true, minOrder: true },
  });
  const merchants: MerchantInfo[] = merchantRows.map((m) => ({
    id: m.id, slug: m.slug, name: m.name, storeType: m.storeType,
    deliveryFeeBani: m.deliveryFee ? leiToBaniExact(m.deliveryFee) : 0,
    freeDeliveryOverBani: m.freeDeliveryOver ? leiToBaniExact(m.freeDeliveryOver) : null,
    minOrderBani: m.minOrder ? leiToBaniExact(m.minOrder) : null,
  }));

  const lines: ListLine[] = wanted
    .map((w: { slug: string; qty: number; mode: SubstitutionMode; requestedQuantity: number | null }) => {
      const p = bySlug.get(w.slug);
      return p ? { productId: p.id, qty: w.qty, substitutionMode: w.mode, requestedQuantity: w.requestedQuantity } : null;
    })
    .filter(Boolean) as ListLine[];

  // The shopper's own preferences, when signed in.
  const user = await getCurrentUser();
  const [favs, blocks] = user
    ? await Promise.all([
        prisma.userFavorite.findMany({ where: { userId: user.id }, select: { productId: true, source: true } }),
        prisma.userBlocklist.findMany({ where: { userId: user.id }, select: { productId: true, brand: true } }),
      ])
    : [[], []];
  const ctx: UserContext = {
    favouriteProductIds: new Set(favs.filter((f) => f.source === "EXPLICIT").map((f) => f.productId)),
    inferredFavouriteProductIds: new Set(favs.filter((f) => f.source === "INFERRED").map((f) => f.productId)),
    blockedProductIds: new Set(blocks.map((b) => b.productId).filter((x): x is number => x != null)),
    blockedBrands: new Set(blocks.map((b) => b.brand?.toLowerCase()).filter((x): x is string => !!x)),
    preferPrivateLabel: Boolean(body.preferPrivateLabel),
    hasLoyaltyCards: Boolean(body.hasLoyaltyCards),
  };

  const result = optimizeBasket(merchants, lines, offerLikes, ctx, {
    maxStores: Number(body.maxStores) > 0 ? Number(body.maxStores) : 3,
    allowedMerchantTypes: Array.isArray(body.allowedMerchantTypes) ? body.allowedMerchantTypes : undefined,
    requireAllItems: Boolean(body.requireAllItems),
    preferPrivateLabel: Boolean(body.preferPrivateLabel),
  });

  const unknown = slugs.filter((s) => !bySlug.has(s));
  return NextResponse.json({ ...result, unknown });
}
