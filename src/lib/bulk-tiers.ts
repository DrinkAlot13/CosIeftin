// Quantity discounts ("preț la cantitate"), shared by the item page, the listing and the
// basket optimizer so all three agree about what a shopper actually pays.
//
// 5,024 tier rows across 3,938 offers have been in the database for several sessions and have
// never been rendered anywhere. DCNeu is a discounter: the ladder IS the offer, and a page
// showing only the single-unit price is showing the least attractive number on the card.
//
// A LADDER IS ONLY SHOWN WHEN THE PRICE IT HANGS OFF IS TRUSTED. A flagged offer's base price
// is withheld from display, and a discount computed against a withheld price is a made-up
// number wearing a percentage. Same for a stale one. `visibleTiers` is the only way these
// reach a component, and it enforces that.

import type { Bani } from "./price/parsePrice";

export type TierRow = {
  minQuantity: number;
  unitPriceBani: number;
  /** discount vs the base price, in basis points (1000 = 10%) */
  discountBp: number | null;
};

export type OfferLikeForTiers = {
  priceBani: number | null;
  price: number;
  flagged: boolean;
  isStale: boolean;
  availability: string;
  tiers?: TierRow[];
};

export type Ladder = {
  baseBani: number;
  rungs: TierRow[];
  /** cheapest per-unit price anywhere on the ladder, base included */
  bestUnitBani: number;
  /** quantity at which `bestUnitBani` starts */
  bestFromQty: number;
  /** best saving vs the base, in basis points */
  bestDiscountBp: number;
};

const baseOf = (o: OfferLikeForTiers): number => o.priceBani ?? Math.round(o.price * 100);

/**
 * The ladder to render for this offer, or null if there is nothing trustworthy to show.
 *
 * Returns null when:
 *   • there are no rungs
 *   • the offer is flagged — its base price is withheld, so a discount against it is fiction
 *   • the offer is stale or out of stock — the ladder describes a price nobody can pay today
 *   • a rung is not actually cheaper than the base, which means the ladder was mis-parsed
 */
export function visibleTiers(o: OfferLikeForTiers): Ladder | null {
  if (!o.tiers || o.tiers.length === 0) return null;
  if (o.flagged || o.isStale || o.availability !== "in stock") return null;
  const baseBani = baseOf(o);
  if (baseBani <= 0) return null;

  const rungs = [...o.tiers]
    .filter((t) => t.minQuantity > 1 && t.unitPriceBani > 0 && t.unitPriceBani < baseBani)
    .sort((a, b) => a.minQuantity - b.minQuantity);
  if (rungs.length === 0) return null;

  // A ladder must get cheaper as quantity rises. One that does not is a parse error, and
  // showing it would advertise a discount that is not there.
  for (let i = 1; i < rungs.length; i++) {
    if (rungs[i].unitPriceBani > rungs[i - 1].unitPriceBani) return null;
  }

  const best = rungs[rungs.length - 1];
  return {
    baseBani,
    rungs,
    bestUnitBani: best.unitPriceBani,
    bestFromQty: best.minQuantity,
    bestDiscountBp: Math.round(((baseBani - best.unitPriceBani) / baseBani) * 10_000),
  };
}

/** Discount of one rung vs the base, in basis points — recomputed, never trusted from the row. */
export function discountBpOf(baseBani: number, unitPriceBani: number): number {
  if (baseBani <= 0) return 0;
  return Math.round(((baseBani - unitPriceBani) / baseBani) * 10_000);
}

/** The unit price that applies when buying `qty` of this offer. */
export function unitPriceAtQty(ladder: Ladder | null, baseBani: number, qty: number): Bani {
  if (!ladder) return baseBani;
  let price = baseBani;
  for (const r of ladder.rungs) if (qty >= r.minQuantity) price = r.unitPriceBani;
  return price;
}

export type NextRungHint = {
  /** how many more units to add */
  addUnits: number;
  atQty: number;
  newUnitBani: number;
  currentUnitBani: number;
  /** total saved on the whole line at the new quantity, vs paying the current unit price */
  savesBani: number;
};

/**
 * "Add one more and you pay 6,61 instead of 7,00."
 *
 * Only surfaced when the NEXT rung is within `within` units, and only when reaching it
 * actually costs less IN TOTAL than the current quantity. Buying two more tins to save 4 bani
 * a tin is not a saving, it is an upsell, and telling a shopper otherwise on a price
 * comparison site is the one thing this whole project exists not to do.
 */
export function nextRungHint(
  ladder: Ladder | null,
  baseBani: number,
  qty: number,
  within = 2,
): NextRungHint | null {
  if (!ladder || qty < 1) return null;
  const currentUnit = unitPriceAtQty(ladder, baseBani, qty);
  const next = ladder.rungs.find((r) => r.minQuantity > qty && r.minQuantity - qty <= within);
  if (!next) return null;
  const currentTotal = currentUnit * qty;
  const newTotal = next.unitPriceBani * next.minQuantity;
  if (newTotal >= currentTotal) return null;
  return {
    addUnits: next.minQuantity - qty,
    atQty: next.minQuantity,
    newUnitBani: next.unitPriceBani,
    currentUnitBani: currentUnit,
    savesBani: currentTotal - newTotal,
  };
}
