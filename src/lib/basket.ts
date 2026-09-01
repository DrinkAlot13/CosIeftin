import { isShelfPrice, normalizePriceSource } from "./price-source";
// Grocery-list optimizer: given items + every chain's offers, work out the two
// answers users care about — cheapest SINGLE store (one trip) vs cheapest SPLIT
// (buy each item wherever it's cheapest) — and the savings/convenience trade-off.
//
// "Cheapest" has to be HONEST, so the optimizer accounts for:
//   • delivery fees + free-delivery thresholds (a basket that ignores a 20-lei fee is wrong)
//   • minimum order values (a store you can't actually order from isn't an option)
//   • loyalty-card prices, kept separate from the shelf price so they're never silently mixed
//   • price source — an aggregator/delivery price carries a markup over shelf price

export type OfferForBasket = {
  price: number;
  availability: string;
  loyaltyPrice?: number | null;
  priceSource?: string | null;
  merchant: {
    id: number;
    slug: string;
    name: string;
    color: string | null;
    storeType?: string | null;
    deliveryFee?: number | null;
    freeDeliveryOver?: number | null;
    minOrder?: number | null;
  };
};

export type ProductForBasket = {
  id: number;
  slug: string;
  name: string;
  unit: string;
  packLabelSample?: string | null;
  offers: OfferForBasket[];
};

export type BasketItemInput = { productId: number; qty: number };

export type BasketOptions = {
  /** true = also use loyalty-card prices in the totals (the shopper says they have the card) */
  useLoyalty?: boolean;
  /** true = include delivery fees / min-order feasibility in store totals (default true) */
  includeDelivery?: boolean;
};

export type PerItemResult = {
  productId: number;
  slug: string;
  name: string;
  qty: number;
  cheapest: {
    merchantId: number;
    merchantName: string;
    merchantSlug: string;
    unitPrice: number;
    linePrice: number;
    /** true when this price needs the store's loyalty card */
    loyalty: boolean;
    priceSource: string;
  } | null;
};

export type StoreTotal = {
  merchantId: number;
  slug: string;
  name: string;
  color: string | null;
  storeType: string | null;
  /** goods only, before delivery */
  subtotal: number;
  deliveryFee: number;
  /** subtotal + deliveryFee — what you actually pay */
  total: number;
  missing: number;
  itemsFound: number;
  /** the basket is under this store's minimum order, so you can't check out */
  belowMinOrder: boolean;
  minOrder: number | null;
  /** how much more you'd need to add to reach the minimum order (null when not blocked) */
  needForMinOrder: number | null;
  /** how much more you'd need to spend for free delivery (null = n/a or already free) */
  needForFreeDelivery: number | null;
  usesLoyalty: boolean;
  priceSource: string;
};

/** Effective price for one offer, honouring the loyalty-card toggle. */
function effectivePrice(o: OfferForBasket, useLoyalty: boolean): { price: number; loyalty: boolean } {
  if (useLoyalty && o.loyaltyPrice != null && o.loyaltyPrice > 0 && o.loyaltyPrice < o.price) {
    return { price: o.loyaltyPrice, loyalty: true };
  }
  return { price: o.price, loyalty: false };
}

function bestOffer(offers: OfferForBasket[], useLoyalty: boolean): { offer: OfferForBasket; price: number; loyalty: boolean } | null {
  const inStock = offers.filter((o) => o.availability === "in stock");
  const pool = inStock.length > 0 ? inStock : offers;
  let best: { offer: OfferForBasket; price: number; loyalty: boolean } | null = null;
  for (const o of pool) {
    const e = effectivePrice(o, useLoyalty);
    if (!best || e.price < best.price) best = { offer: o, price: e.price, loyalty: e.loyalty };
  }
  return best;
}

/** Delivery cost for a given goods subtotal at one merchant. */
export function deliveryFor(m: OfferForBasket["merchant"], subtotal: number): number {
  const fee = m.deliveryFee ?? 0;
  if (fee <= 0) return 0;
  if (m.freeDeliveryOver != null && subtotal >= m.freeDeliveryOver) return 0;
  return fee;
}

export function optimizeBasket(products: ProductForBasket[], items: BasketItemInput[], opts: BasketOptions = {}) {
  const useLoyalty = opts.useLoyalty ?? false;
  const includeDelivery = opts.includeDelivery ?? true;
  const byId = new Map(products.map((p) => [p.id, p]));
  const merchants = new Map<number, OfferForBasket["merchant"]>();
  for (const p of products) for (const o of p.offers) merchants.set(o.merchant.id, o.merchant);

  // Per-item cheapest (the SPLIT strategy).
  const perItem: PerItemResult[] = [];
  let splitGoods = 0;
  const splitByMerchant = new Map<number, number>();
  for (const { productId, qty } of items) {
    const p = byId.get(productId);
    if (!p) continue;
    const best = bestOffer(p.offers, useLoyalty);
    if (best) {
      const line = best.price * qty;
      splitGoods += line;
      splitByMerchant.set(best.offer.merchant.id, (splitByMerchant.get(best.offer.merchant.id) ?? 0) + line);
      perItem.push({
        productId,
        slug: p.slug,
        name: p.name,
        qty,
        cheapest: {
          merchantId: best.offer.merchant.id,
          merchantName: best.offer.merchant.name,
          merchantSlug: best.offer.merchant.slug,
          unitPrice: best.price,
          linePrice: line,
          loyalty: best.loyalty,
          priceSource: best.offer.priceSource ?? "shelf",
        },
      });
    } else {
      perItem.push({ productId, slug: p.slug, name: p.name, qty, cheapest: null });
    }
  }

  // A split across N stores pays delivery at EVERY online store it touches — that is the
  // honest cost of splitting, and often the thing that makes one trip cheaper.
  let splitDelivery = 0;
  if (includeDelivery) {
    for (const [mid, sub] of splitByMerchant) {
      const m = merchants.get(mid);
      if (m) splitDelivery += deliveryFor(m, sub);
    }
  }
  const splitTotal = splitGoods + splitDelivery;

  // Single-store totals.
  const storeTotals: StoreTotal[] = [];
  for (const m of merchants.values()) {
    let subtotal = 0;
    let missing = 0;
    let found = 0;
    let usesLoyalty = false;
    let source = "shelf";
    for (const { productId, qty } of items) {
      const p = byId.get(productId);
      if (!p) continue;
      const here =
        p.offers.find((x) => x.merchant.id === m.id && x.availability === "in stock") ??
        p.offers.find((x) => x.merchant.id === m.id);
      if (here) {
        const e = effectivePrice(here, useLoyalty);
        subtotal += e.price * qty;
        if (e.loyalty) usesLoyalty = true;
        // Compare against the canonical vocabulary, never a string literal: "shelf" matched
        // only half the shelf offers, because the other half were spelled "SHELF".
        if (here.priceSource && !isShelfPrice(normalizePriceSource(here.priceSource))) source = here.priceSource;
        found++;
      } else {
        missing++;
      }
    }
    const deliveryFee = includeDelivery ? deliveryFor(m, subtotal) : 0;
    const minOrder = m.minOrder ?? null;
    storeTotals.push({
      merchantId: m.id,
      slug: m.slug,
      name: m.name,
      color: m.color,
      storeType: m.storeType ?? null,
      subtotal,
      deliveryFee,
      total: subtotal + deliveryFee,
      missing,
      itemsFound: found,
      belowMinOrder: minOrder != null && found > 0 && subtotal < minOrder,
      minOrder,
      needForMinOrder: minOrder != null && found > 0 && subtotal < minOrder ? +(minOrder - subtotal).toFixed(2) : null,
      needForFreeDelivery:
        m.freeDeliveryOver != null && deliveryFee > 0 ? Math.max(0, m.freeDeliveryOver - subtotal) : null,
      usesLoyalty,
      priceSource: source,
    });
  }
  // rank by completeness, then by what you actually pay
  storeTotals.sort((a, b) => a.missing - b.missing || a.total - b.total);

  // A store you can't check out from (below its minimum order) is not a real option.
  const completeStores = storeTotals.filter((s) => s.missing === 0 && !s.belowMinOrder);
  const bestComplete = completeStores.length > 0 ? completeStores[0] : null;
  // …but "no answer" is a bad answer. When every complete store is blocked only by its
  // minimum order, surface the cheapest one anyway so the UI can say how much more to add.
  const blockedByMin = storeTotals.filter((s) => s.missing === 0 && s.belowMinOrder);
  const bestBlockedByMinOrder = bestComplete ? null : blockedByMin[0] ?? null;
  const storesInSplit = splitByMerchant.size;
  const savings = bestComplete ? Math.max(0, bestComplete.total - splitTotal) : null;

  return {
    perItem,
    splitTotal,
    splitGoods,
    splitDelivery,
    storeTotals,
    bestComplete,
    bestBlockedByMinOrder,
    storesInSplit,
    savings,
    itemCount: items.length,
    useLoyalty,
  };
}

export type BasketResult = ReturnType<typeof optimizeBasket>;
