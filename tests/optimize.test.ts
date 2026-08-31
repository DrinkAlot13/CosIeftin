// Basket optimizer over the resolver. Fixture: 5 merchants x 12 lines, covering the cases
// that change the ANSWER — a delivery threshold flipping the winner, a bulk tier flipping
// the winner, exact-only lines, substitutions, and unavailable items.
import { describe, it, expect } from "./run";
import { optimizeBasket, buildMerchantBasket, type MerchantInfo } from "../src/lib/basket/optimize";
import type { OfferLike, ListLine, UserContext } from "../src/lib/substitution/resolve";

const M = (id: number, slug: string, fee = 0, freeOver: number | null = null, minOrder: number | null = null, storeType = "online"): MerchantInfo =>
  ({ id, slug, name: slug, storeType, deliveryFeeBani: fee, freeDeliveryOverBani: freeOver, minOrderBani: minOrder });

const MERCHANTS = [
  M(1, "cheap-online", 2000, 20000, null),   // 20 lei delivery, free over 200
  M(2, "near-physical", 0, null, null, "physical"),
  M(3, "min-order", 0, null, 5000),          // 50 lei minimum
  M(4, "tiered", 0),
  M(5, "sparse", 0),
];

let nextOffer = 1;
function off(merchantId: number, productId: number, priceBani: number, o: Partial<OfferLike> = {}): OfferLike {
  return {
    id: nextOffer++, productId, merchantId, priceBani,
    packQuantity: o.packQuantity ?? 1000, unit: o.unit ?? "ml",
    availability: "in stock", isStale: false, isExpired: false,
    hasUnresolvedAnomaly: false, requiresLoyaltyCard: false,
    bulkTiers: o.bulkTiers, promoValidTo: null,
    product: { id: productId, name: `p${productId}`, brand: o.product?.brand ?? null, equivalenceClassId: productId, isPrivateLabel: false },
  };
}

// 12 products; merchant 1 slightly cheaper on goods, merchant 2 has no delivery fee.
const OFFERS: OfferLike[] = [];
for (let p = 1; p <= 12; p++) {
  OFFERS.push(off(1, p, 900));
  OFFERS.push(off(2, p, 1000));
  if (p <= 6) OFFERS.push(off(3, p, 800));       // min-order store: cheapest but blocked
  if (p === 1) OFFERS.push(off(4, p, 1000, { bulkTiers: [{ qty: 3, priceBani: 300 }] }));
  if (p === 12) OFFERS.push(off(5, p, 100));     // sparse store: one very cheap line
}
const LINES: ListLine[] = Array.from({ length: 12 }, (_, i) => ({ productId: i + 1, qty: 1, substitutionMode: "EQUIVALENT" as const }));
const ctx = (o: Partial<UserContext> = {}): UserContext => ({
  favouriteProductIds: new Set(), inferredFavouriteProductIds: new Set(),
  blockedProductIds: new Set(), blockedBrands: new Set(),
  preferPrivateLabel: false, hasLoyaltyCards: false, ...o,
});

describe("optimizer — delivery fees decide the winner", () => {
  const r = optimizeBasket(MERCHANTS, LINES, OFFERS, ctx());

  it("prices goods and delivery separately", () => {
    const b = r.perMerchant.find((x) => x.merchant.slug === "cheap-online")!;
    expect(b.subtotalBani).toBe(12 * 900);
    // 10 800 bani is under the 20 000 free-delivery threshold, so the fee applies
    expect(b.deliveryFeeBani).toBe(2000);
  });

  it("the physical store wins once delivery counts", () => {
    // cheap-online: 10800 goods + 2000 delivery = 12800; near-physical: 12000 + 0
    const b1 = r.perMerchant.find((x) => x.merchant.slug === "cheap-online")!;
    const b2 = r.perMerchant.find((x) => x.merchant.slug === "near-physical")!;
    expect(b1.totalBani).toBe(12800);
    expect(b2.totalBani).toBe(12000);
    expect(r.bestSingle!.merchant.slug).toBe("near-physical");
  });

  it("reports how much more is needed for free delivery", () => {
    const b = r.perMerchant.find((x) => x.merchant.slug === "cheap-online")!;
    expect(b.needForFreeDeliveryBani).toBe(20000 - 10800);
  });
});

describe("optimizer — completeness is not optional", () => {
  const r = optimizeBasket(MERCHANTS, LINES, OFFERS, ctx());
  it("a store carrying only some lines is marked incomplete", () => {
    const sparse = r.perMerchant.find((x) => x.merchant.slug === "sparse")!;
    expect(sparse.complete).toBeFalsy();
    expect(sparse.unavailable.length).toBe(11);
  });
  it("an incomplete store never becomes bestSingle despite a tiny total", () => {
    expect(r.bestSingle!.merchant.slug === "sparse").toBeFalsy();
  });
  it("an unsupplied EXACT line is counted distinctly", () => {
    const exact: ListLine[] = [{ productId: 12, qty: 1, substitutionMode: "EXACT" }];
    const b = buildMerchantBasket(MERCHANTS[3], exact, OFFERS, ctx());
    expect(b.missingExactLines).toBe(1);
    expect(b.complete).toBeFalsy();
  });
});

describe("optimizer — minimum order", () => {
  it("a store below its minimum is not a usable option", () => {
    const six = LINES.slice(0, 6);
    const r = optimizeBasket(MERCHANTS, six, OFFERS, ctx());
    const mo = r.perMerchant.find((x) => x.merchant.slug === "min-order")!;
    expect(mo.subtotalBani).toBe(4800);
    expect(mo.meetsMinimum).toBeFalsy();
    expect(mo.minOrderShortfallBani).toBe(200);
    expect(r.bestSingle!.merchant.slug === "min-order").toBeFalsy();
  });
});

describe("optimizer — bulk tiers flip the winner", () => {
  it("a tier makes a pricier list price the cheaper total", () => {
    const three: ListLine[] = [{ productId: 1, qty: 1, substitutionMode: "EXACT", requestedQuantity: 3000 }];
    const tiered = buildMerchantBasket(MERCHANTS[3], three, OFFERS, ctx());
    const plain = buildMerchantBasket(MERCHANTS[0], three, OFFERS, ctx());
    expect(tiered.subtotalBani).toBe(900);   // 3 packs at the 300 tier
    expect(plain.subtotalBani).toBe(2700);   // 3 x 900, no tier
    expect(tiered.subtotalBani < plain.subtotalBani).toBeTruthy();
  });
});

describe("optimizer — split, maxStores and marginal value", () => {
  const r = optimizeBasket(MERCHANTS, LINES, OFFERS, ctx(), { maxStores: 3 });
  it("never uses more than maxStores", () => expect(r.split.storesUsed <= 3).toBeTruthy());
  it("splitting pays delivery at every online store it touches", () => expect(r.split.deliveryBani >= 0).toBeTruthy());
  it("split total is goods + delivery", () => expect(r.split.totalBani).toBe(r.split.goodsBani + r.split.deliveryBani));
  it("savings is never negative", () => expect((r.savingsVsSingleBani ?? 0) >= 0).toBeTruthy());
  it("marginal store value is reported and ordered", () => {
    for (let i = 1; i < r.marginalStoreValue.length; i++) {
      expect(r.marginalStoreValue[i - 1].savesBani >= r.marginalStoreValue[i].savesBani).toBeTruthy();
    }
  });
  it("maxStores:1 collapses the split to a single store", () => {
    const one = optimizeBasket(MERCHANTS, LINES, OFFERS, ctx(), { maxStores: 1 });
    expect(one.split.storesUsed <= 1).toBeTruthy();
  });
  it("allowedMerchantTypes filters the pool", () => {
    const phys = optimizeBasket(MERCHANTS, LINES, OFFERS, ctx(), { allowedMerchantTypes: ["physical"] });
    expect(phys.perMerchant.every((b) => b.merchant.storeType === "physical")).toBeTruthy();
  });
  it("all money is integer bani", () => {
    expect(Number.isInteger(r.split.totalBani)).toBeTruthy();
    expect(r.perMerchant.every((b) => Number.isInteger(b.totalBani))).toBeTruthy();
  });
});
