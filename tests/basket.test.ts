// The basket optimizer is the product — these pin the "honest cheapest" rules:
// delivery fees, free-delivery thresholds, minimum orders, and loyalty prices.
import { describe, it, expect } from "./run";
import { optimizeBasket, deliveryFor, type ProductForBasket } from "../src/lib/basket";

const shop = (id: number, slug: string, extra: Partial<{ deliveryFee: number; freeDeliveryOver: number; minOrder: number }> = {}) => ({
  id, slug, name: slug, color: null, storeType: "online", ...extra,
});

/** two stores: `cheap` has lower goods prices but charges delivery; `near` is physical */
function fixture(): ProductForBasket[] {
  return [
    {
      id: 1, slug: "lapte", name: "Lapte 1L", unit: "l",
      offers: [
        { price: 5, availability: "in stock", merchant: shop(1, "cheap", { deliveryFee: 20, freeDeliveryOver: 200 }) },
        { price: 6, availability: "in stock", merchant: shop(2, "near") },
      ],
    },
    {
      id: 2, slug: "paine", name: "Paine 500g", unit: "kg",
      offers: [
        { price: 4, availability: "in stock", merchant: shop(1, "cheap", { deliveryFee: 20, freeDeliveryOver: 200 }) },
        { price: 5, availability: "in stock", merchant: shop(2, "near") },
      ],
    },
  ];
}
const items = [{ productId: 1, qty: 1 }, { productId: 2, qty: 1 }];

describe("basket — delivery fees make 'cheapest' honest", () => {
  it("adds the delivery fee to an online store's total", () => {
    const r = optimizeBasket(fixture(), items);
    const cheap = r.storeTotals.find((s) => s.slug === "cheap")!;
    expect(cheap.subtotal).toBeCloseTo(9);
    expect(cheap.deliveryFee).toBeCloseTo(20);
    expect(cheap.total).toBeCloseTo(29);
  });

  it("the physical store with higher goods prices wins once delivery counts", () => {
    const r = optimizeBasket(fixture(), items);
    expect(r.bestComplete!.slug).toBe("near"); // 11 lei beats 9 + 20 delivery
  });

  it("ignoring delivery flips the answer (and would be wrong)", () => {
    const r = optimizeBasket(fixture(), items, { includeDelivery: false });
    expect(r.bestComplete!.slug).toBe("cheap");
  });

  it("free-delivery threshold zeroes the fee", () => {
    expect(deliveryFor(shop(1, "x", { deliveryFee: 20, freeDeliveryOver: 200 }), 250)).toBe(0);
    expect(deliveryFor(shop(1, "x", { deliveryFee: 20, freeDeliveryOver: 200 }), 150)).toBe(20);
  });

  it("reports how much more is needed for free delivery", () => {
    const r = optimizeBasket(fixture(), items);
    expect(r.storeTotals.find((s) => s.slug === "cheap")!.needForFreeDelivery).toBeCloseTo(191);
  });

  it("a split pays delivery at every online store it touches", () => {
    const products = fixture();
    // make each store cheapest for one item so the split spans both
    products[1].offers[1].price = 1; // "near" cheapest for paine
    const r = optimizeBasket(products, items);
    expect(r.splitGoods).toBeCloseTo(6); // 5 (cheap) + 1 (near)
    expect(r.splitDelivery).toBeCloseTo(20); // "cheap" still charges delivery
    expect(r.splitTotal).toBeCloseTo(26);
  });
});

describe("basket — minimum order", () => {
  it("a store below its minimum order is not offered as best", () => {
    const products = fixture();
    for (const p of products) p.offers = [p.offers[0]]; // only the "cheap" store
    products[0].offers[0].merchant = shop(1, "cheap", { deliveryFee: 0, minOrder: 50 });
    products[1].offers[0].merchant = shop(1, "cheap", { deliveryFee: 0, minOrder: 50 });
    const r = optimizeBasket(products, items);
    expect(r.storeTotals[0].belowMinOrder).toBeTruthy();
    expect(r.bestComplete).toBe(null);
  });
});

describe("basket — loyalty prices are never silently mixed", () => {
  const withLoyalty = (): ProductForBasket[] => [
    {
      id: 1, slug: "cafea", name: "Cafea 500g", unit: "kg",
      offers: [
        { price: 30, loyaltyPrice: 20, availability: "in stock", merchant: shop(1, "card-store") },
        { price: 25, availability: "in stock", merchant: shop(2, "plain") },
      ],
    },
  ];
  const one = [{ productId: 1, qty: 1 }];

  it("without the card, the shelf price is used", () => {
    const r = optimizeBasket(withLoyalty(), one);
    expect(r.perItem[0].cheapest!.merchantSlug).toBe("plain");
    expect(r.perItem[0].cheapest!.unitPrice).toBeCloseTo(25);
    expect(r.perItem[0].cheapest!.loyalty).toBeFalsy();
  });

  it("with the card, the loyalty price wins and is labelled", () => {
    const r = optimizeBasket(withLoyalty(), one, { useLoyalty: true });
    expect(r.perItem[0].cheapest!.merchantSlug).toBe("card-store");
    expect(r.perItem[0].cheapest!.unitPrice).toBeCloseTo(20);
    expect(r.perItem[0].cheapest!.loyalty).toBeTruthy();
  });
});
