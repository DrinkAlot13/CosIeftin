// SGR deposits. The money a shopper hands over that our price column never showed.
//
// The deposit scales with the number of CONTAINERS, not with volume, and that is exactly why
// it matters here: a 6 x 0.33 l pack carries 3,00 lei and a 2 l bottle of the same drink
// carries 0,50. Those are two products we show on the same page, and the till difference is
// 2,50 lei in a direction our comparison never mentioned.
import { describe, it, expect } from "./run";
import {
  depositFor, priceWithDepositBani, readPublishedDepositBani, SGR_PER_CONTAINER_BANI,
} from "../src/lib/deposit";

describe("SGR — the six-pack versus the bottle", () => {
  it("charges 3,00 lei on a 6 x 0.33 l pack", () => {
    const d = depositFor({ unit: "l", unitSize: 1.98, packCount: 6, categorySlug: "bauturi" })!;
    expect(d.containerCount).toBe(6);
    expect(d.totalBani).toBe(300);
  });

  it("charges 0,50 lei on a 2 l bottle of the same drink", () => {
    const d = depositFor({ unit: "l", unitSize: 2, packCount: 1, categorySlug: "bauturi" })!;
    expect(d.containerCount).toBe(1);
    expect(d.totalBani).toBe(50);
  });

  it("so two products on one page differ by 2,50 lei at the till", () => {
    const six = depositFor({ unit: "l", unitSize: 1.98, packCount: 6, categorySlug: "bauturi" })!;
    const two = depositFor({ unit: "l", unitSize: 2, packCount: 1, categorySlug: "bauturi" })!;
    expect(six.totalBani - two.totalBani).toBe(250);
  });
});

describe("SGR — the merchant's own figure wins", () => {
  it("uses a published per-container value over the derived one", () => {
    const d = depositFor({
      unit: "l", unitSize: 1.5, packCount: 1, categorySlug: "bauturi",
      publishedPerContainerBani: 50,
    })!;
    expect(d.fromMerchant).toBe(true);
    expect(d.totalBani).toBe(50);
  });

  it("a published figure also settles that SGR applies, whatever the category says", () => {
    // A shop printing GARANTIE_SGR on a product is telling us it carries one. Our category
    // list is a fallback, not an authority.
    const d = depositFor({
      unit: null, unitSize: null, packCount: 4, categorySlug: "necunoscut",
      publishedPerContainerBani: 50,
    })!;
    expect(d.totalBani).toBe(200);
    expect(d.fromMerchant).toBe(true);
  });

  it("reads Auchan's published attribute", () => {
    const blob = '{"x":1,"GARANTIE_SGR":["0,5"],"ComisionPartener":["7.5"]}';
    expect(readPublishedDepositBani("auchan", blob)).toBe(50);
  });

  it("returns null for a merchant that publishes nothing", () => {
    expect(readPublishedDepositBani("metro", '{"GARANTIE_SGR":["0,5"]}')).toBe(null);
    expect(readPublishedDepositBani("auchan", '{"nothing":true}')).toBe(null);
  });
});

describe("SGR — where it does NOT apply", () => {
  it("returns null, not zero, outside the scheme", () => {
    // "no deposit" is a fact about the product; "a deposit of nothing" would be a claim we
    // cannot support. Keeping them distinguishable matters when the value reaches a page.
    expect(depositFor({ unit: "kg", unitSize: 1, packCount: 1, categorySlug: "lactate" })).toBe(null);
  });

  it("skips containers outside 0.1 l - 3 l", () => {
    // SGR covers beverage containers in that range only.
    expect(depositFor({ unit: "l", unitSize: 0.05, packCount: 1, categorySlug: "bauturi" })).toBe(null);
    expect(depositFor({ unit: "l", unitSize: 5, packCount: 1, categorySlug: "bauturi" })).toBe(null);
  });

  it("uses PER-CONTAINER volume for that test, not pack total", () => {
    // A 6 x 0.5 l pack is 3 l total but each container is 0.5 l, which is in scope.
    const d = depositFor({ unit: "l", unitSize: 3, packCount: 6, categorySlug: "bauturi" })!;
    expect(d.totalBani).toBe(300);
  });

  it("does not invent a deposit for an out-of-scope category", () => {
    expect(depositFor({ unit: "l", unitSize: 1, packCount: 1, categorySlug: "menaj" })).toBe(null);
  });
});

describe("SGR — the total a shopper hands over", () => {
  it("adds the deposit to the price without changing it", () => {
    const d = depositFor({ unit: "l", unitSize: 1.98, packCount: 6, categorySlug: "bauturi" });
    expect(priceWithDepositBani(1169, d)).toBe(1469);
  });

  it("leaves a price alone when there is no deposit", () => {
    expect(priceWithDepositBani(1169, null)).toBe(1169);
  });

  it("uses the statutory 50 bani per container", () => {
    expect(SGR_PER_CONTAINER_BANI).toBe(50);
  });
});
