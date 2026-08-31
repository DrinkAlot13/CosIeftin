// The Indexul CoșMic basket definition + the split-vs-single decision, which is the
// single most consequential number the site shows a shopper.
import { describe, it, expect } from "./run";
import { INDEX_BASKET } from "../src/lib/cosmic-index";
import { optimizeBasket, type ProductForBasket } from "../src/lib/basket";

describe("Indexul CoșMic — basket definition", () => {
  it("covers the staples an INS-style consumer basket needs", () => {
    const keys = INDEX_BASKET.map((b) => b.key);
    for (const need of ["lapte", "paine", "oua", "ulei", "faina", "zahar"]) {
      expect(keys.includes(need)).toBeTruthy();
    }
  });

  it("every line declares a unit and a positive size (so lei/kg normalization works)", () => {
    expect(INDEX_BASKET.every((b) => ["kg", "l", "buc"].includes(b.unit) && b.unitSize > 0)).toBeTruthy();
  });

  it("match terms are diacritic-free, matching how nameNorm is stored", () => {
    expect(INDEX_BASKET.every((b) => !/[ăâîșțşţ]/i.test(b.match))).toBeTruthy();
  });

  it("keys are unique", () => {
    expect(new Set(INDEX_BASKET.map((b) => b.key)).size).toBe(INDEX_BASKET.length);
  });
});

describe("split vs single — the headline decision", () => {
  const m = (id: number, slug: string, fee = 0) => ({ id, slug, name: slug, color: null, storeType: fee ? "online" : "physical", deliveryFee: fee });
  const products: ProductForBasket[] = [
    {
      id: 1, slug: "a", name: "A", unit: "kg",
      offers: [
        { price: 10, availability: "in stock", merchant: m(1, "one-stop") },
        { price: 8, availability: "in stock", merchant: m(2, "far", 15) },
      ],
    },
    {
      id: 2, slug: "b", name: "B", unit: "kg",
      offers: [
        { price: 10, availability: "in stock", merchant: m(1, "one-stop") },
        { price: 9, availability: "in stock", merchant: m(3, "other", 15) },
      ],
    },
  ];
  const items = [{ productId: 1, qty: 1 }, { productId: 2, qty: 1 }];

  it("splitting across two delivery stores pays delivery twice", () => {
    const r = optimizeBasket(products, items);
    expect(r.splitGoods).toBeCloseTo(17);
    expect(r.splitDelivery).toBeCloseTo(30);
  });

  it("one trip wins, and savings is reported as zero (not negative)", () => {
    const r = optimizeBasket(products, items);
    expect(r.bestComplete!.slug).toBe("one-stop");
    expect(r.bestComplete!.total).toBeCloseTo(20);
    expect(r.savings).toBe(0); // 20 - 47 clamps to 0; we never claim negative "savings"
  });

  it("an out-of-stock offer loses to an in-stock one", () => {
    const p: ProductForBasket[] = [{
      id: 1, slug: "a", name: "A", unit: "kg",
      offers: [
        { price: 5, availability: "out of stock", merchant: m(1, "cheap-but-gone") },
        { price: 9, availability: "in stock", merchant: m(2, "available") },
      ],
    }];
    const r = optimizeBasket(p, [{ productId: 1, qty: 1 }]);
    expect(r.perItem[0].cheapest!.merchantSlug).toBe("available");
  });

  it("quantities multiply the line, not just the unit price", () => {
    const r = optimizeBasket(products, [{ productId: 1, qty: 3 }]);
    expect(r.splitGoods).toBeCloseTo(24); // 8 × 3
  });

  it("blocked-by-minimum store is surfaced instead of returning nothing", () => {
    const p: ProductForBasket[] = [{
      id: 1, slug: "a", name: "A", unit: "kg",
      offers: [{ price: 10, availability: "in stock", merchant: { ...m(1, "big"), minOrder: 50 } }],
    }];
    const r = optimizeBasket(p, [{ productId: 1, qty: 1 }]);
    expect(r.bestComplete).toBe(null);
    expect(r.bestBlockedByMinOrder!.slug).toBe("big");
    expect(r.bestBlockedByMinOrder!.needForMinOrder).toBeCloseTo(40);
  });
});
