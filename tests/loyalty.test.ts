// A price you can only get with a loyalty card, and the two ways it goes wrong.
//
// Both were live on 2026-09-09 and both were found by asking what Penny's tile actually
// publishes. Neither was visible from inside: every row was well-formed, every gate green.
//
//   65 Kaufland offers held a CARD price in `price` with `requiresLoyaltyCard` false.
//      `scrape-kaufland` takes `formattedPrice ?? loyaltyFormattedPrice`, so a flyer item headed
//      "Reducere cu Kaufland Card" contributes its card price as if anyone could pay it. Its own
//      comment predicted the consequence — "an unlabeled card price would silently undercut
//      every other store" — and nothing implemented the label.
//
//   44 offers held `loyaltyPrice` EQUAL to `price`, because one string filled both. A column
//      that duplicates another looks like a second fact and is none.
//
// THE DIRECTION IS WHAT MAKES THIS WORSE THAN THE DELIVERY-PLATFORM CASE. A platform price is
// marked UP, so an unlabelled one merely looks expensive and loses. A card price is marked DOWN,
// so an unlabelled one WINS a comparison it should not win.
import { describe, it, expect } from "./run";
import { cardSavingBani, loyaltyLabel, requiresCard, shelfLabel, withCardPhrase } from "../src/lib/loyalty";
import { optimizeBasket, type OfferForBasket, type ProductForBasket } from "../src/lib/basket";

const shop = { id: 1, slug: "kaufland", name: "Kaufland", color: null, storeType: "physical" };

const offer = (o: Partial<OfferForBasket> & { price: number }): OfferForBasket =>
  ({ availability: "in stock", merchant: shop, ...o }) as OfferForBasket;

const one = (offers: OfferForBasket[]): ProductForBasket[] =>
  [{ id: 1, slug: "x", name: "X 1 buc", unit: "buc", offers }];

describe("loyalty — a card price is not a price everyone can pay", () => {
  it("names the merchant's own card", () => {
    expect(loyaltyLabel("penny")).toBe("Preț cu cardul PENNY");
    expect(loyaltyLabel("kaufland")).toBe("Preț cu Kaufland Card");
    expect(shelfLabel("penny")).toBe("fără cardul PENNY");
    expect(withCardPhrase("penny")).toBe("cu cardul PENNY");
  });

  // A merchant we have not established a card name for gets the generic label, never an invented
  // one. Guessing a brand's card name in user-facing Romanian copy is a claim about that brand.
  it("falls back to a generic label rather than inventing a card name", () => {
    expect(loyaltyLabel("some-new-shop")).toBe("Preț cu card de fidelitate");
  });

  // ── THE ECHO. `loyaltyPrice === price` is the shape 44 Kaufland rows held.
  it("reports no saving when the card price equals the shelf price", () => {
    expect(cardSavingBani({
      requiresLoyaltyCard: false, price: 8.99, priceBani: 899, loyaltyPriceBani: 899,
      merchant: { slug: "kaufland", name: "Kaufland" },
    })).toBe(null);
  });

  it("reports no saving when the card price is HIGHER", () => {
    expect(cardSavingBani({
      requiresLoyaltyCard: false, price: 8.99, priceBani: 899, loyaltyPriceBani: 999,
      merchant: { slug: "kaufland", name: "Kaufland" },
    })).toBe(null);
  });

  // Penny's real shape: 22,99 without the card, 17,99 with it.
  it("reports the saving when the card price is genuinely lower", () => {
    expect(cardSavingBani({
      requiresLoyaltyCard: false, price: 22.99, priceBani: 2299, loyaltyPriceBani: 1799,
      merchant: { slug: "penny", name: "Penny" },
    })).toBe(500);
  });

  it("requiresCard reads the flag and nothing else", () => {
    expect(requiresCard({ requiresLoyaltyCard: true })).toBe(true);
    expect(requiresCard({ requiresLoyaltyCard: false })).toBe(false);
  });
});

describe("loyalty — the optimizer may not price a card offer as an ordinary one", () => {
  const basket = (offers: OfferForBasket[], useLoyalty = false) =>
    optimizeBasket(one(offers), [{ productId: 1, qty: 1 }], { useLoyalty });

  // THE HEADLINE. `useLoyalty` defaults to false, which reads like "never use a card price
  // unless asked" — and said nothing about a card price sitting in the `price` column itself.
  it("marks a basket that used a card-only price, even with the toggle off", () => {
    const r = basket([offer({ price: 10, requiresLoyaltyCard: true })]);
    expect(r.storeTotals[0].usesLoyalty).toBe(true);
  });

  it("does not mark an ordinary price", () => {
    const r = basket([offer({ price: 10 })]);
    expect(r.storeTotals[0].usesLoyalty).toBe(false);
  });

  // The older guard, which turned out to be load-bearing: without `loyaltyPrice < price`, the 44
  // echoing rows would have read as a discount of zero and set the flag on every one.
  it("ignores a loyalty price that is not below the shelf price", () => {
    const r = basket([offer({ price: 10, loyaltyPrice: 10 })], true);
    expect(r.storeTotals[0].usesLoyalty).toBe(false);
    expect(r.storeTotals[0].total).toBe(10);
  });

  it("uses a genuinely cheaper card price when the toggle is on, and says so", () => {
    const r = basket([offer({ price: 10, loyaltyPrice: 8 })], true);
    expect(r.storeTotals[0].usesLoyalty).toBe(true);
    expect(r.storeTotals[0].total).toBe(8);
  });
});
