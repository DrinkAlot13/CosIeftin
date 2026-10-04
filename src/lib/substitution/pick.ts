// Pick a concrete product for a NEED — an equivalence class — rather than for a product id.
//
// `resolveLine` answers "this line, at this shop". A recipe asks something earlier: "the shopper
// wants eggs; which eggs, and why?" — before any shop has been chosen and before a product is in
// the cart at all.
//
// This shares `rank` and `isBuyable` with the resolver instead of reimplementing them. That is
// the whole point: two rankings would drift, and the shopper would be shown one product on the
// recipe card and given a different one in the basket for no visible reason.

import { isBuyable, rank, unitPriceBani, type OfferLike, type UserContext } from "./resolve";
import type { PickBasis } from "./explain";

export type Pick = {
  offer: OfferLike;
  basis: PickBasis;
  unitPriceBani: number;
  /** How many other buyable candidates there were. */
  alternatives: number;
};

/**
 * Best product for a class, optionally restricted to one merchant.
 *
 * Returns null when the class has nothing buyable — which is a real answer and must not be
 * papered over with a near-miss from another class. Two of our thirty classes are genuinely
 * empty (no plain chicken breast, no plain 1 kg potato), and a recipe that needs them has to
 * say so rather than quietly substituting something else.
 */
export function pickForClass(
  classId: number,
  ctx: UserContext,
  offers: OfferLike[],
  opts: { merchantId?: number; unitsNeeded?: number; now?: Date } = {},
): Pick | null {
  const now = opts.now ?? new Date();
  const pool = offers.filter(
    (o) =>
      o.product.equivalenceClassId === classId &&
      (opts.merchantId == null || o.merchantId === opts.merchantId),
  );
  const buyable = pool.filter((o) => isBuyable(o, ctx, now).ok);
  if (buyable.length === 0) return null;

  const unitsNeeded = opts.unitsNeeded && opts.unitsNeeded > 0 ? opts.unitsNeeded : 1;
  const ranked = rank(buyable, ctx, unitsNeeded);
  const chosen = ranked[0];

  // WHY this one, in the resolver's own priority order. Read off the same facts `rank` sorted
  // on, so the explanation can never disagree with the choice.
  let basis: PickBasis;
  if (ctx.favouriteProductIds.has(chosen.product.id)) basis = "FAVOURITE";
  else if (ctx.inferredFavouriteProductIds.has(chosen.product.id)) basis = "INFERRED";
  else if (ctx.preferPrivateLabel && chosen.product.isPrivateLabel) basis = "PRIVATE_LABEL";
  else if (buyable.length === 1) basis = "ONLY_OPTION";
  else basis = "CHEAPEST";

  return {
    offer: chosen,
    basis,
    unitPriceBani: unitPriceBani(chosen, unitsNeeded),
    alternatives: buyable.length - 1,
  };
}

/** An empty context, for callers with no signed-in shopper. */
export function anonymousContext(preferPrivateLabel = false): UserContext {
  return {
    favouriteProductIds: new Set(),
    inferredFavouriteProductIds: new Set(),
    blockedProductIds: new Set(),
    blockedBrands: new Set(),
    blockedAttributeTags: new Set(),
    preferPrivateLabel,
    hasLoyaltyCards: false,
  };
}
