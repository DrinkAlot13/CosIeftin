// Substitution resolver. The eggs case from the spec is the centrepiece: EQUIVALENT must
// substitute a different brand of the same need, EXACT must refuse.
import { describe, it, expect } from "./run";
import { resolveLine, unitPriceBani, totalForPacks, type OfferLike, type UserContext } from "../src/lib/substitution/resolve";

const EGGS_CLASS = 1;
const MILK_CLASS = 2;

function offer(p: Partial<OfferLike> & { id: number; productId: number; merchantId: number; priceBani: number; name: string }): OfferLike {
  return {
    id: p.id, productId: p.productId, merchantId: p.merchantId, priceBani: p.priceBani,
    packQuantity: p.packQuantity ?? 10, unit: p.unit ?? "buc",
    availability: p.availability ?? "in stock",
    isStale: p.isStale ?? false, isExpired: p.isExpired ?? false,
    hasUnresolvedAnomaly: p.hasUnresolvedAnomaly ?? false,
    requiresLoyaltyCard: p.requiresLoyaltyCard ?? false,
    bulkTiers: p.bulkTiers, promoValidTo: p.promoValidTo ?? null,
    product: {
      id: p.productId, name: p.name,
      brand: p.product?.brand ?? null,
      equivalenceClassId: p.product?.equivalenceClassId ?? EGGS_CLASS,
      isPrivateLabel: p.product?.isPrivateLabel ?? false,
    },
  };
}

const ctx = (over: Partial<UserContext> = {}): UserContext => ({
  favouriteProductIds: new Set(), inferredFavouriteProductIds: new Set(),
  blockedProductIds: new Set(), blockedBrands: new Set(),
  preferPrivateLabel: false, hasLoyaltyCards: false, ...over,
});

// THE spec case: "Ouă L 10 buc Auchan" requested; Mega has a different brand, same need.
const auchanEggs = offer({ id: 1, productId: 100, merchantId: 1, priceBani: 1500, name: "Oua Auchan L 10 buc", product: { id: 100, name: "", brand: "Auchan", equivalenceClassId: EGGS_CLASS, isPrivateLabel: true } });
const megaEggs = offer({ id: 2, productId: 200, merchantId: 2, priceBani: 1300, name: "Oua Mega L 10 buc", product: { id: 200, name: "", brand: "Mega", equivalenceClassId: EGGS_CLASS, isPrivateLabel: true } });
const ALL = [auchanEggs, megaEggs];

describe("resolver — the eggs case", () => {
  it("EQUIVALENT substitutes a different brand meeting the same need", () => {
    const r = resolveLine({ productId: 100, qty: 1, substitutionMode: "EQUIVALENT" }, 2, ctx(), ALL);
    expect(r.status).toBe("SUBSTITUTED");
    expect(r.offer!.product.id).toBe(200);
    expect(r.reason.code).toBe("SUBSTITUTED_EQUIVALENT");
  });

  it("EXACT refuses and reports UNAVAILABLE at a merchant that lacks it", () => {
    const r = resolveLine({ productId: 100, qty: 1, substitutionMode: "EXACT" }, 2, ctx(), ALL);
    expect(r.status).toBe("UNAVAILABLE");
    expect(r.offer).toBe(null);
    expect(r.reason.code).toBe("EXACT_ONLY_NOT_STOCKED");
  });

  it("EXACT succeeds at the merchant that does stock it", () => {
    const r = resolveLine({ productId: 100, qty: 1, substitutionMode: "EXACT" }, 1, ctx(), ALL);
    expect(r.status).toBe("EXACT");
    expect(r.totalBani).toBe(1500);
  });

  it("the substitution reports the per-unit saving as data, not prose", () => {
    const r = resolveLine({ productId: 100, qty: 1, substitutionMode: "EQUIVALENT" }, 2, ctx(), ALL);
    expect(r.reason.requestedUnitPriceBani).toBe(150);
    expect(r.reason.chosenUnitPriceBani).toBe(130);
    expect(r.reason.savingPerUnitBani).toBe(20);
  });
});

describe("resolver — modes", () => {
  const napolact = offer({ id: 10, productId: 300, merchantId: 1, priceBani: 700, packQuantity: 1000, unit: "ml", name: "Lapte Napolact 1L", product: { id: 300, name: "", brand: "Napolact", equivalenceClassId: MILK_CLASS, isPrivateLabel: false } });
  const napolactBig = offer({ id: 11, productId: 301, merchantId: 1, priceBani: 950, packQuantity: 1500, unit: "ml", name: "Lapte Napolact 1.5L", product: { id: 301, name: "", brand: "Napolact", equivalenceClassId: MILK_CLASS, isPrivateLabel: false } });
  const store = offer({ id: 12, productId: 302, merchantId: 1, priceBani: 550, packQuantity: 1000, unit: "ml", name: "Lapte Auchan 1L", product: { id: 302, name: "", brand: "Auchan", equivalenceClassId: MILK_CLASS, isPrivateLabel: true } });
  const milk = [napolact, napolactBig, store];

  it("SAME_BRAND stays within the brand even when another is cheaper", () => {
    const r = resolveLine({ productId: 300, qty: 1, substitutionMode: "SAME_BRAND" }, 1, ctx(), milk);
    expect(r.offer!.product.brand).toBe("Napolact");
  });
  it("CHEAPEST crosses brands", () => {
    const r = resolveLine({ productId: 300, qty: 1, substitutionMode: "CHEAPEST" }, 1, ctx(), milk);
    expect(r.offer!.product.id).toBe(302);
  });
  it("EQUIVALENT with no class falls back to the exact product, never a guess", () => {
    const orphan = offer({ id: 20, productId: 400, merchantId: 1, priceBani: 900, name: "Ceva", product: { id: 400, name: "", brand: null, equivalenceClassId: null as unknown as number, isPrivateLabel: false } });
    const r = resolveLine({ productId: 400, qty: 1, substitutionMode: "EQUIVALENT" }, 1, ctx(), [orphan]);
    expect(r.status).toBe("EXACT");
  });
  it("preferPrivateLabel outranks a marginally cheaper national brand", () => {
    const r = resolveLine({ productId: 300, qty: 1, substitutionMode: "CHEAPEST" }, 1, ctx({ preferPrivateLabel: true }), milk);
    expect(r.offer!.product.isPrivateLabel).toBeTruthy();
  });
  it("an explicit favourite wins over a cheaper alternative", () => {
    const r = resolveLine({ productId: 300, qty: 1, substitutionMode: "CHEAPEST" }, 1, ctx({ favouriteProductIds: new Set([300]) }), milk);
    expect(r.offer!.product.id).toBe(300);
  });
  it("an inferred favourite loses to an explicit one", () => {
    const r = resolveLine({ productId: 300, qty: 1, substitutionMode: "CHEAPEST" }, 1,
      ctx({ favouriteProductIds: new Set([302]), inferredFavouriteProductIds: new Set([300]) }), milk);
    expect(r.offer!.product.id).toBe(302);
  });
});

describe("resolver — exclusions a shopper cannot buy through", () => {
  const base = { id: 30, productId: 500, merchantId: 1, priceBani: 1000, name: "X" };
  const alt = offer({ id: 31, productId: 501, merchantId: 1, priceBani: 1200, name: "Y" });

  it("stale offers are excluded and counted", () => {
    const r = resolveLine({ productId: 500, qty: 1, substitutionMode: "EXACT" }, 1, ctx(), [offer({ ...base, isStale: true })]);
    expect(r.status).toBe("UNAVAILABLE");
    expect(r.reason.excluded!.stale).toBe(1);
  });
  it("expired promos are excluded SEPARATELY from stale", () => {
    const r = resolveLine({ productId: 500, qty: 1, substitutionMode: "EXACT" }, 1, ctx(), [offer({ ...base, isExpired: true })]);
    expect(r.reason.excluded!.expired).toBe(1);
    expect(r.reason.excluded!.stale).toBe(0);
  });
  it("a passed promo window expires the offer even if the flag is unset", () => {
    const past = new Date(Date.now() - 86400e3);
    const r = resolveLine({ productId: 500, qty: 1, substitutionMode: "EXACT" }, 1, ctx(), [offer({ ...base, promoValidTo: past })]);
    expect(r.status).toBe("UNAVAILABLE");
    expect(r.reason.excluded!.expired).toBe(1);
  });
  it("an unresolved price anomaly excludes the offer", () => {
    const r = resolveLine({ productId: 500, qty: 1, substitutionMode: "EXACT" }, 1, ctx(), [offer({ ...base, hasUnresolvedAnomaly: true })]);
    expect(r.reason.excluded!.anomaly).toBe(1);
  });
  it("a blocked brand is excluded and the alternative wins", () => {
    const blocked = offer({ ...base, product: { id: 500, name: "", brand: "Nope", equivalenceClassId: EGGS_CLASS, isPrivateLabel: false } });
    const r = resolveLine({ productId: 500, qty: 1, substitutionMode: "EQUIVALENT" }, 1, ctx({ blockedBrands: new Set(["nope"]) }), [blocked, alt]);
    expect(r.offer!.product.id).toBe(501);
    expect(r.reason.excluded!.blocked).toBe(1);
  });
  // A card-only price is not one every shopper can pay. `hasLoyaltyCards` used to be threaded
  // through UserContext and never read anywhere, so every shopper saw every card price as if
  // they could get it — the exact thing a card price must never do silently.
  it("a card-only offer is excluded when the shopper has no loyalty cards", () => {
    const r = resolveLine({ productId: 500, qty: 1, substitutionMode: "EXACT" }, 1, ctx({ hasLoyaltyCards: false }), [offer({ ...base, requiresLoyaltyCard: true })]);
    expect(r.status).toBe("UNAVAILABLE");
    expect(r.reason.excluded!.loyalty).toBe(1);
  });
  it("a card-only offer is usable once the shopper says they carry a card", () => {
    const r = resolveLine({ productId: 500, qty: 1, substitutionMode: "EXACT" }, 1, ctx({ hasLoyaltyCards: true }), [offer({ ...base, requiresLoyaltyCard: true })]);
    expect(r.status).toBe("EXACT");
  });
});

describe("resolver — quantity plans and bulk tiers", () => {
  const half = offer({ id: 40, productId: 600, merchantId: 1, priceBani: 500, packQuantity: 500, unit: "g", name: "Faina 500g" });

  it("a 1 kg request is met by 2 x 500 g", () => {
    const r = resolveLine({ productId: 600, qty: 1, substitutionMode: "EXACT", requestedQuantity: 1000 }, 1, ctx(), [half]);
    expect(r.quantityPlan[0].units).toBe(2);
    expect(r.totalBani).toBe(1000);
    expect(r.reason.code).toBe("SPLIT_PACKS");
    expect(r.reason.packs).toBe(2);
  });
  it("bulk tiers lower the effective total", () => {
    const tiered = offer({ id: 41, productId: 601, merchantId: 1, priceBani: 500, packQuantity: 500, unit: "g", name: "Faina tier", bulkTiers: [{ qty: 3, priceBani: 400 }] });
    expect(totalForPacks(tiered, 3)).toBe(1200);
    expect(totalForPacks(tiered, 2)).toBe(1000);
  });
  it("unit price reflects the tier once the quantity qualifies", () => {
    const tiered = offer({ id: 42, productId: 602, merchantId: 1, priceBani: 500, packQuantity: 500, unit: "g", name: "X", bulkTiers: [{ qty: 3, priceBani: 400 }] });
    // 400 bani per 500 g pack = 800 bani per KILOGRAM
    expect(unitPriceBani(tiered, 1500)).toBe(800);
  });
  it("money stays integer — no fractional bani anywhere", () => {
    const r = resolveLine({ productId: 600, qty: 3, substitutionMode: "EXACT" }, 1, ctx(), [half]);
    expect(Number.isInteger(r.totalBani)).toBeTruthy();
  });
});
