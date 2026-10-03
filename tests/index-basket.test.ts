// The Indexul CosIeftin basket definition + the split-vs-single decision, which is the
// single most consequential number the site shows a shopper.
import { describe, it, expect } from "./run";
import { INDEX_BASKET } from "../src/lib/index-basket";
import { changeBetween, periodChanges, type SeriesPoint } from "../src/lib/index-series";
import { optimizeBasket, type ProductForBasket } from "../src/lib/basket";

describe("Indexul CosIeftin — basket definition", () => {
  it("covers the staples a Romanian household buys every week", () => {
    const keys = INDEX_BASKET.map((b) => b.key);
    for (const need of ["lapte", "paine", "oua", "ulei", "faina", "zahar", "unt", "orez", "cafea", "hartie", "detergent"]) {
      expect(keys.includes(need)).toBeTruthy();
    }
  });

  it("has 40 lines", () => {
    expect(INDEX_BASKET.length).toBe(40);
  });

  it("every line is PINNED to one product slug and records the name it was pinned to", () => {
    // The pin is the whole design. A line without one resolves by search at runtime, which is
    // how coffee creamer was priced as coffee and how the total moved 26.8% in three days.
    expect(INDEX_BASKET.every((b) => b.slug.length > 0 && b.expectedName.length > 0)).toBeTruthy();
  });

  it("keys and slugs are both unique, so no product can be counted twice", () => {
    expect(new Set(INDEX_BASKET.map((b) => b.key)).size).toBe(INDEX_BASKET.length);
    expect(new Set(INDEX_BASKET.map((b) => b.slug)).size).toBe(INDEX_BASKET.length);
  });

  it("every line is filed under a group, so the page can show what is in the basket", () => {
    expect(INDEX_BASKET.every((b) => b.group.length > 0)).toBeTruthy();
  });
});

describe("Indexul CosIeftin — comparisons refuse unlike things", () => {
  const pt = (day: string, total: number, priced: number): SeriesPoint => ({
    day, total, priced, of: 40, complete: priced === 40, byMerchant: [],
  });

  it("compares two days that priced the same number of lines", () => {
    const c = changeBetween(pt("2026-08-01", 100, 40), pt("2026-09-01", 110, 40));
    expect(c!.pct).toBeCloseTo(10);
  });

  it("REFUSES to compare a 40-line total with a 37-line total", () => {
    // Otherwise the number reports the three missing products as a price fall.
    expect(changeBetween(pt("2026-08-01", 100, 40), pt("2026-09-01", 92, 37))).toBe(null);
  });

  it("refuses when there is nothing to compare against", () => {
    expect(changeBetween(undefined, pt("2026-09-01", 100, 40))).toBe(null);
    expect(changeBetween(pt("2026-08-01", 0, 40), pt("2026-09-01", 100, 40))).toBe(null);
  });

  it("reports no month-over-month figure when the series is younger than 28 days", () => {
    // Six days of history cannot produce a monthly change, and inventing one from the earliest
    // point available would silently relabel a 6-day move as a monthly move.
    const short = [pt("2026-08-28", 100, 40), pt("2026-09-02", 104, 40)];
    const { month, year, spanDays } = periodChanges(short);
    expect(month).toBe(null);
    expect(year).toBe(null);
    expect(spanDays).toBe(5);
  });

  it("reports month-over-month once two points are 28 days apart", () => {
    const long = [pt("2026-07-01", 100, 40), pt("2026-08-05", 105, 40)];
    expect(periodChanges(long).month!.pct).toBeCloseTo(5);
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
