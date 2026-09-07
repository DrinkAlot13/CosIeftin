// Loading the substitution engine's inputs from the database, in ONE place.
//
// The mapping from an Offer row to an `OfferLike` is fiddly — canonical pack quantity from the
// product name, bulk tiers out of a JSON column, integer bani, unresolved-anomaly count — and it
// was written inline inside the basket v2 route. Every new caller (recipe resolution, per-shop
// completion, the recipe audit) would have copied it, and a copy that drifts is how Metro and
// Mega Image lost `productUrl` on every offer they wrote: an object literal that satisfies the
// type but omits a field the compiler cannot miss.
//
// So: one loader, one context builder, one merchant mapper. Callers pass a filter, not a shape.

import { prisma } from "../db";
import { leiToBaniExact } from "../price/parsePrice";
import { parseQuantity } from "../units/parseQuantity";
import type { OfferLike, UserContext } from "./resolve";
import type { MerchantInfo } from "../basket/optimize";
import { validateTiers, type RawTier } from "../price/bulkTiers";

/** Offers that could serve these equivalence classes and/or these products. */
export async function loadOffers(opts: {
  productIds?: number[];
  classIds?: number[];
  take?: number;
}): Promise<OfferLike[]> {
  const or: object[] = [];
  if (opts.productIds?.length) or.push({ productId: { in: opts.productIds } });
  if (opts.classIds?.length) or.push({ product: { equivalenceClassId: { in: opts.classIds } } });
  if (or.length === 0) return [];

  const offers = await prisma.offer.findMany({
    where: { OR: or, flagged: false, merchant: { active: true } },
    select: {
      id: true, productId: true, merchantId: true, priceBani: true, price: true,
      availability: true, isStale: true, isExpired: true, promoValidTo: true,
      requiresLoyaltyCard: true, bulkTiers: true, depositBani: true, containerCount: true,
      product: {
        select: {
          id: true, name: true, brand: true, slug: true,
          equivalenceClassId: true, unit: true, unitSize: true,
          attributes: { where: { key: "isPrivateLabel" }, select: { value: true } },
        },
      },
      _count: { select: { anomalies: { where: { resolved: false } } } },
    },
    take: opts.take ?? 8000,
  });

  return offers.map((o) => {
    // Canonical pack quantity: G / ML / BUC.
    const q = parseQuantity(o.product.name);
    const packQuantity = q ? q.value : o.product.unit === "buc" ? o.product.unitSize : o.product.unitSize * 1000;
    // ── THE LADDER IS VALIDATED BEFORE THE OPTIMIZER MAY USE IT.
    //
    // `Offer.bulkTiers` is a legacy JSON column and the `BulkTier` TABLE is the gated copy the
    // item page renders. They are the same fact in two places and they DO NOT AGREE: of the 274
    // offers carrying both, ZERO match. The JSON holds rungs like `1@1255` — a quantity-1
    // "tier", which is the base price wearing a discount's clothes, and exactly what
    // `validateTiers` refuses.
    //
    // Until the column is retired (a decision for the owner, since dropping it would lose the
    // 189 offers that have JSON and no table rows), the optimizer runs the same gate the page
    // runs. An unvalidated ladder produced a discount computed against nothing.
    const basePriceBani = o.priceBani ?? leiToBaniExact(o.price);
    let tiers: { qty: number; priceBani: number }[] | undefined;
    if (o.bulkTiers) {
      try {
        const parsed = JSON.parse(o.bulkTiers) as { qty: number; price: number }[];
        const raw: RawTier[] = parsed.map((t) => ({ minQuantity: t.qty, unitPriceBani: leiToBaniExact(t.price) }));
        const v = validateTiers(basePriceBani, raw);
        tiers = v.ok && v.tiers.length > 0 ? v.tiers.map((t) => ({ qty: t.minQuantity, priceBani: t.unitPriceBani })) : undefined;
      } catch { /* malformed tiers are simply absent */ }
    }
    return {
      id: o.id,
      productId: o.productId,
      merchantId: o.merchantId,
      // priceBani is authoritative; the legacy float is a fallback until it is dropped.
      priceBani: o.priceBani ?? leiToBaniExact(o.price),
      packQuantity: packQuantity > 0 ? packQuantity : 1,
      unit: q?.unit ?? (o.product.unit === "buc" ? "BUC" : o.product.unit === "kg" ? "G" : "ML"),
      availability: o.availability,
      isStale: o.isStale,
      isExpired: o.isExpired,
      hasUnresolvedAnomaly: o._count.anomalies > 0,
      requiresLoyaltyCard: o.requiresLoyaltyCard,
      bulkTiers: tiers,
      promoValidTo: o.promoValidTo,
      product: {
        id: o.product.id,
        name: o.product.name,
        brand: o.product.brand,
        equivalenceClassId: o.product.equivalenceClassId,
        isPrivateLabel: o.product.attributes.some((a) => a.value === "true"),
      },
    };
  });
}

/** Extra per-offer facts the engine does not need but the per-shop view does. */
export type OfferExtras = { slug: string; depositBani: number | null; containerCount: number | null; productUrl: string | null };

export async function loadOfferExtras(offerIds: number[]): Promise<Map<number, OfferExtras>> {
  if (offerIds.length === 0) return new Map();
  const rows = await prisma.offer.findMany({
    where: { id: { in: offerIds } },
    select: { id: true, depositBani: true, containerCount: true, productUrl: true, url: true, product: { select: { slug: true } } },
  });
  return new Map(
    rows.map((r) => [r.id, {
      slug: r.product.slug,
      depositBani: r.depositBani,
      containerCount: r.containerCount,
      productUrl: r.productUrl ?? r.url ?? null,
    }]),
  );
}

/** The shopper's own preferences. Anonymous callers get an empty, permissive context. */
export async function loadUserContext(
  userId: number | null,
  opts: { preferPrivateLabel?: boolean; hasLoyaltyCards?: boolean } = {},
): Promise<UserContext> {
  const base: UserContext = {
    favouriteProductIds: new Set(),
    inferredFavouriteProductIds: new Set(),
    blockedProductIds: new Set(),
    blockedBrands: new Set(),
    preferPrivateLabel: Boolean(opts.preferPrivateLabel),
    hasLoyaltyCards: Boolean(opts.hasLoyaltyCards),
  };
  if (userId == null) return base;

  const [favs, blocks] = await Promise.all([
    prisma.userFavorite.findMany({ where: { userId }, select: { productId: true, source: true } }),
    prisma.userBlocklist.findMany({ where: { userId }, select: { productId: true, brand: true } }),
  ]);
  for (const f of favs) {
    (f.source === "INFERRED" ? base.inferredFavouriteProductIds : base.favouriteProductIds).add(f.productId);
  }
  for (const b of blocks) {
    if (b.productId != null) base.blockedProductIds.add(b.productId);
    if (b.brand) base.blockedBrands.add(b.brand.toLowerCase());
  }
  return base;
}

/** Active merchants, with delivery economics in bani. */
export async function loadMerchants(): Promise<MerchantInfo[]> {
  const rows = await prisma.merchant.findMany({
    where: { active: true },
    select: { id: true, slug: true, name: true, storeType: true, deliveryFee: true, freeDeliveryOver: true, minOrder: true, websiteUrl: true },
  });
  return rows.map((m) => ({
    id: m.id, slug: m.slug, name: m.name, storeType: m.storeType,
    deliveryFeeBani: m.deliveryFee ? leiToBaniExact(m.deliveryFee) : 0,
    freeDeliveryOverBani: m.freeDeliveryOver ? leiToBaniExact(m.freeDeliveryOver) : null,
    minOrderBani: m.minOrder ? leiToBaniExact(m.minOrder) : null,
  }));
}
