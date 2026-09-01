// What may be shown struck through, and what may not.
//
// THE DEFECT THIS FIXES. The item page rendered:
//
//     cel mai mic preț  12,00   ~~17,99~~
//
// where 17,99 was ANOTHER MERCHANT'S price for the same product. Struck through, next to the
// lowest price, that reads as "was 17,99, now 12,00" — a discount that does not exist. Nobody
// ever sold it at 17,99 and then dropped it. It is the price at a different shop.
//
// A strikethrough is a claim about ONE offer's own history. It is not a way to render a range.
//
// THE OMNIBUS DEVIATION, flagged for the owner rather than decided silently.
//
// The brief allows striking either STRIKETHROUGH or OMNIBUS_30D. CLAUDE.md says the opposite
// about the second one, and it is right: the EU Omnibus figure is the LOWEST price in the past
// 30 days, printed because the law requires it. Striking it implies the shopper is saving that
// difference, when the number is a floor rather than a former price — showing "~~7,99~~ 9,99"
// would claim a discount on a price INCREASE.
//
// So this module strikes only a genuine former price, and gives the Omnibus figure its own
// explicit label. Both numbers still reach the page; only the discount claim is withheld.

export type ReferenceKind = "STRIKETHROUGH" | "OMNIBUS_30D" | "LOYALTY" | "RRP" | null;

export type OfferLikeForReference = {
  priceBani: number | null;
  price: number;
  referencePriceBani: number | null;
  referencePriceKind: string | null;
};

export type PriceDisplay =
  | { kind: "strike"; wasBani: number; nowBani: number; savedBani: number }
  | { kind: "omnibus"; lowBani: number; nowBani: number }
  | { kind: "plain"; nowBani: number };

const baseOf = (o: OfferLikeForReference): number => o.priceBani ?? Math.round(o.price * 100);

/**
 * How to render ONE offer's price.
 *
 * The reference must belong to this same offer and must be strictly above its current price;
 * anything else is either a range (not a discount) or a price rise (definitely not a discount).
 */
export function priceDisplayFor(o: OfferLikeForReference): PriceDisplay {
  const nowBani = baseOf(o);
  const ref = o.referencePriceBani;
  if (ref == null || ref <= nowBani) return { kind: "plain", nowBani };

  if (o.referencePriceKind === "STRIKETHROUGH") {
    return { kind: "strike", wasBani: ref, nowBani, savedBani: ref - nowBani };
  }
  if (o.referencePriceKind === "OMNIBUS_30D") {
    return { kind: "omnibus", lowBani: ref, nowBani };
  }
  // LOYALTY and RRP are neither a former price nor a legal floor. Shown plainly.
  return { kind: "plain", nowBani };
}

/**
 * A cross-store spread, stated as a range and never as a discount.
 *
 * Returns null when there is nothing to say — one shop, or every shop at the same price.
 */
export function priceRange(lowBani: number, highBani: number, shops: number): string | null {
  if (shops < 2 || highBani <= lowBani) return null;
  const fmt = (b: number): string =>
    (b / 100).toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `între ${fmt(lowBani)} și ${fmt(highBani)} lei în ${shops} magazine`;
}
