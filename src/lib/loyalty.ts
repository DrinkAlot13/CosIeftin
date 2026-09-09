// ── A LOYALTY-CARD PRICE IS NOT A PRICE EVERYONE CAN PAY.
//
// Same shape as `lib/platform/visibility.ts`, and for the same reason: a number that is only
// available under a condition must carry that condition wherever it is shown, or it silently
// undercuts every honest price beside it. A delivery-platform price is marked up; a card price
// is marked DOWN, which is worse — it wins comparisons it should not win.
//
// ── WHAT THE SWEEP FOUND, 2026-09-09, across every merchant with a loyalty scheme.
//
//   penny       publishes BOTH, plainly marked: "preț fără PENNY card 22,99" beside
//               "preț cu PENNY card 17,99". We store the shelf figure as `price` and the card
//               figure in `loyaltyPriceBani`. 28 of 29 offers carry both.
//   kaufland    flyer items headed "Reducere cu Kaufland Card" carry ONLY a loyalty price, so
//               `price` IS a card price on 17 live offers — and `requiresLoyaltyCard` was false
//               on every one of them.
//   mega-image  displays ONE price. Its own page says the Connect discount is applied to the
//               displayed price only "daca clientul este logat … si are asociat cardul Connect".
//               An anonymous fetch therefore gets the non-card price. Nothing to capture.
//   carrefour   no card price on the product page — the only "card" text is the gift-card and
//               memory-card nav.
//   auchan      no separate card price either; the card text is promo terms ("in limita a 12
//               unitati / card client"). A condition on a promo, not a second figure.
//
// So exactly one merchant publishes a distinct card price, and exactly one merchant stores a
// card price in the `price` column. Both are handled here rather than in two places.

/** The merchant's own name for its card. Blank means "we do not know" and must not be invented. */
const CARD_NAMES: Record<string, string> = {
  penny: "cardul PENNY",
  kaufland: "Kaufland Card",
  "glovo-kaufland": "Kaufland Card",
  "mega-image": "cardul Connect",
};

export type LoyaltyBearing = {
  requiresLoyaltyCard: boolean;
  priceBani?: number | null;
  price: number;
  loyaltyPriceBani?: number | null;
  merchant: { slug: string; name: string };
};

/** The shopper needs a card to pay the price we are showing. */
export function requiresCard(o: { requiresLoyaltyCard: boolean }): boolean {
  return o.requiresLoyaltyCard === true;
}

/**
 * A card price that is genuinely CHEAPER than the shelf price, in bani. Null otherwise.
 *
 * The "otherwise" is doing real work. Kaufland's scraper wrote `loyaltyPrice` from the same
 * string it wrote `price` from, so all 14 rows that had one held the SAME number — a column
 * that looks like a second fact and carries none. `effectivePrice` in the optimiser already
 * guarded against it with `loyaltyPrice < price`, which is why nothing visibly broke; the guard
 * was load-bearing and nobody knew.
 */
export function cardSavingBani(o: LoyaltyBearing): number | null {
  const shelf = o.priceBani ?? Math.round(o.price * 100);
  const card = o.loyaltyPriceBani;
  if (card == null || !(card > 0) || card >= shelf) return null;
  return shelf - card;
}

/** Romanian label for a price the shopper can only get with a card. */
export function loyaltyLabel(merchantSlug: string): string {
  const card = CARD_NAMES[merchantSlug];
  return card ? `Preț cu ${card}` : "Preț cu card de fidelitate";
}

/** Romanian label for the shelf price beside a card price. */
export function shelfLabel(merchantSlug: string): string {
  const card = CARD_NAMES[merchantSlug];
  return card ? `fără ${card}` : "fără card";
}

/**
 * The mid-sentence form: "cu cardul PENNY".
 *
 * Separate from `loyaltyLabel` because a brand name must not be case-folded to fit a sentence.
 * The first version lowercased the whole label and rendered "preț cu cardul penny" — the shop's
 * own name, in its own copy, spelled wrong.
 */
export function withCardPhrase(merchantSlug: string): string {
  const card = CARD_NAMES[merchantSlug];
  return card ? `cu ${card}` : "cu card de fidelitate";
}

export const LOYALTY_BADGE = "💳";
