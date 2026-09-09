// Selgros's split price — every misreading the card makes available, refused by name.
//
// The groups below are exactly what `parseDom` extracts from three real cards on
// https://www.selgros.ro/, captured 2026-09-09. No network, no browser: `composeSplitPrice` is
// the pure stage, so the dangerous part is testable on its own.
//
// The card offers four wrong answers and no error for any of them:
//
//     34      the lei span alone
//     99      the bani span alone
//     3499    both spans concatenated as one number
//     7,09    the promo validity date "07/09/2026" read as an amount
//
// and on a promo card, a fifth: 42,99, the STRUCK price, which is simply the first group.
import { describe, it, expect } from "./run";
import { composeSplitPrice, type PriceGroup } from "../scripts/adapters/runner";
import { parsePrice } from "../src/lib/price/parsePrice";
import { selgros } from "../scripts/adapters/selgros";

/** LEROY SOMON 1 2 KG — one price, 34,99 per kg. */
const PLAIN: PriceGroup[] = [{ parts: ["34", "99"], struck: false }];

/** LAVRAC 200 300 GR KG — "- 30 %", was 42,99, now 29,99 per kg. */
const PROMO: PriceGroup[] = [
  { parts: ["42", "99"], struck: true },
  { parts: ["29", "99"], struck: false },
];

/** PASTRAV EVISCERAT — same shape, no percentage badge: was 36,99, now 35,99. */
const PROMO_NO_BADGE: PriceGroup[] = [
  { parts: ["36", "99"], struck: true },
  { parts: ["35", "99"], struck: false },
];

describe("Selgros — a price split across elements", () => {
  it("joins the lei and bani spans", () => {
    const r = composeSplitPrice(PLAIN);
    expect(r.priceText).toBe("34,99");
    expect(parsePrice(r.priceText!)).toBe(3499);
    expect(r.referenceText).toBe(null);
  });

  // The one that matters most: the first group on a promo card is the OLD price.
  it("takes the unstruck price, never the struck one", () => {
    const r = composeSplitPrice(PROMO);
    expect(r.priceText).toBe("29,99");
    expect(parsePrice(r.priceText!)).toBe(2999);
    expect(r.referenceText).toBe("42,99"); // kept as the reference, not discarded
  });

  it("works without the percentage badge too", () => {
    const r = composeSplitPrice(PROMO_NO_BADGE);
    expect(r.priceText).toBe("35,99");
    expect(r.referenceText).toBe("36,99");
  });

  // ── EVERY SHAPE THAT IS NOT EXACTLY (lei, bani) IS REFUSED.
  //
  // Not "handled leniently". Selgros prints no currency symbol, so a lenient reader has no way
  // to tell a price from a quantity or half a date, and the existing behaviour it replaces was
  // `parsePrice` returning null — which is why this merchant had zero offers instead of wrong
  // ones. A refusal is recorded by the runner; a guess is not on offer.
  it("refuses a single part — 34 alone is not a price", () => {
    expect(composeSplitPrice([{ parts: ["34"], struck: false }]).priceText).toBe(null);
  });

  it("refuses three parts — an unseen card shape, not a probable price", () => {
    expect(composeSplitPrice([{ parts: ["34", "99", "12"], struck: false }]).priceText).toBe(null);
  });

  it("refuses a one-digit decimal", () => {
    expect(composeSplitPrice([{ parts: ["34", "9"], struck: false }]).priceText).toBe(null);
  });

  it("refuses non-numeric parts, so 'per kg' can never become a price", () => {
    expect(composeSplitPrice([{ parts: ["per kg", "99"], struck: false }]).priceText).toBe(null);
  });

  it("refuses a date fragment", () => {
    expect(composeSplitPrice([{ parts: ["07", "09", "2026"], struck: false }]).priceText).toBe(null);
  });

  it("yields nothing when every group is struck — no price is better than the old price", () => {
    const r = composeSplitPrice([{ parts: ["42", "99"], struck: true }]);
    expect(r.priceText).toBe(null);
    expect(r.referenceText).toBe("42,99");
  });

  it("finds no price in an empty card rather than inventing one", () => {
    expect(composeSplitPrice([]).priceText).toBe(null);
  });
});

describe("Selgros — the adapter config is what makes the above reachable", () => {
  it("declares priceParts with a strike marker, or old and new are indistinguishable", () => {
    expect(selgros.dom?.priceParts?.group).toBe(".sf-product-price div.leading-8");
    expect(selgros.dom?.priceParts?.strikeMarker).toBe("span.absolute");
  });

  // A `price` selector matching the wrapper is exactly how "per kg 34 99 07/09/2026" became the
  // price text. There must not be one.
  it("declares NO plain price selector", () => {
    expect(selgros.dom?.price.length).toBe(0);
  });

  // The empty route was measured, not guessed: 64 cards on `/`, 0 on the assortment page.
  it("keeps only the route that actually yields cards", () => {
    expect(selgros.routes.length).toBe(1);
    expect(selgros.routes[0].url).toBe("https://www.selgros.ro/");
  });
});
