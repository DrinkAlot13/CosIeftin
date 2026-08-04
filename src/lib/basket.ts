// Grocery-list optimizer: given items + every chain's offers, work out the two
// answers users care about — cheapest SINGLE store (one trip) vs cheapest SPLIT
// (buy each item wherever it's cheapest) — and the savings/convenience trade-off.

export type OfferForBasket = {
  price: number;
  availability: string;
  merchant: { id: number; slug: string; name: string; color: string | null };
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

export type PerItemResult = {
  productId: number;
  slug: string;
  name: string;
  qty: number;
  cheapest: { merchantId: number; merchantName: string; merchantSlug: string; unitPrice: number; linePrice: number } | null;
};

export type StoreTotal = {
  merchantId: number;
  slug: string;
  name: string;
  color: string | null;
  total: number; // over the items this store carries
  missing: number;
  itemsFound: number;
};

function bestOffer(offers: OfferForBasket[]): OfferForBasket | null {
  const inStock = offers.filter((o) => o.availability === "in stock");
  const pool = inStock.length > 0 ? inStock : offers;
  let best: OfferForBasket | null = null;
  for (const o of pool) if (!best || o.price < best.price) best = o;
  return best;
}

export function optimizeBasket(products: ProductForBasket[], items: BasketItemInput[]) {
  const byId = new Map(products.map((p) => [p.id, p]));
  const merchants = new Map<number, OfferForBasket["merchant"]>();
  for (const p of products) for (const o of p.offers) merchants.set(o.merchant.id, o.merchant);

  // Per-item cheapest (the SPLIT strategy).
  const perItem: PerItemResult[] = [];
  let splitTotal = 0;
  for (const { productId, qty } of items) {
    const p = byId.get(productId);
    if (!p) continue;
    const best = bestOffer(p.offers);
    if (best) {
      splitTotal += best.price * qty;
      perItem.push({
        productId,
        slug: p.slug,
        name: p.name,
        qty,
        cheapest: {
          merchantId: best.merchant.id,
          merchantName: best.merchant.name,
          merchantSlug: best.merchant.slug,
          unitPrice: best.price,
          linePrice: best.price * qty,
        },
      });
    } else {
      perItem.push({ productId, slug: p.slug, name: p.name, qty, cheapest: null });
    }
  }

  // Single-store totals.
  const storeTotals: StoreTotal[] = [];
  for (const m of merchants.values()) {
    let total = 0;
    let missing = 0;
    let found = 0;
    for (const { productId, qty } of items) {
      const p = byId.get(productId);
      if (!p) continue;
      const here =
        p.offers.find((x) => x.merchant.id === m.id && x.availability === "in stock") ??
        p.offers.find((x) => x.merchant.id === m.id);
      if (here) {
        total += here.price * qty;
        found++;
      } else {
        missing++;
      }
    }
    storeTotals.push({ merchantId: m.id, slug: m.slug, name: m.name, color: m.color, total, missing, itemsFound: found });
  }
  storeTotals.sort((a, b) => a.missing - b.missing || a.total - b.total);

  const completeStores = storeTotals.filter((s) => s.missing === 0);
  const bestComplete = completeStores.length > 0 ? completeStores[0] : null;
  const storesInSplit = new Set(perItem.filter((pi) => pi.cheapest).map((pi) => pi.cheapest!.merchantId)).size;
  const savings = bestComplete ? Math.max(0, bestComplete.total - splitTotal) : null;

  return { perItem, splitTotal, storeTotals, bestComplete, storesInSplit, savings, itemCount: items.length };
}

export type BasketResult = ReturnType<typeof optimizeBasket>;
