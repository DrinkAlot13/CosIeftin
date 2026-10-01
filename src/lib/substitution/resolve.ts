// Substitution resolver: for ONE shopping-list line at ONE merchant, decide what the
// shopper actually gets — the exact product, an acceptable substitute, or nothing.
//
// Design rules:
//   • Returns DATA, never Romanian prose. The reason is machine-readable so the UI owns
//     the wording (and so tests can assert on it).
//   • A quantity plan, not just an offer: a 1 kg request can be met by 2×500 g.
//   • Money in integer bani throughout.
//   • Excludes what a shopper cannot actually buy: blocklisted, stale, expired, or
//     carrying an unresolved price anomaly.

import type { Bani } from "../price/parsePrice";

/** How far this line may be substituted. */
export type SubstitutionMode = "EXACT" | "SAME_BRAND" | "EQUIVALENT" | "CHEAPEST";

export type OfferLike = {
  id: number;
  productId: number;
  merchantId: number;
  priceBani: Bani;
  /** total canonical quantity this pack contains (G / ML / BUC) */
  packQuantity: number;
  unit: string;
  availability: string;
  isStale: boolean;
  isExpired: boolean;
  hasUnresolvedAnomaly: boolean;
  requiresLoyaltyCard: boolean;
  /** cheaper unit prices at higher quantities, if the merchant offers them */
  bulkTiers?: { qty: number; priceBani: Bani }[];
  promoValidTo?: Date | null;
  product: {
    id: number;
    name: string;
    brand: string | null;
    equivalenceClassId: number | null;
    isPrivateLabel: boolean;
  };
};

export type ListLine = {
  productId: number;
  qty: number;
  substitutionMode: SubstitutionMode;
  pinnedProductId?: number | null;
  /** what they want in canonical units; falls back to qty × the pinned pack */
  requestedQuantity?: number | null;
  requestedUnit?: string | null;
  /**
   * Products the caller has already determined are STRUCTURALLY similar to this line's
   * product (same head noun + canonical unit + a size band — see
   * `substitution/structural-equivalence.ts`), for use ONLY when the requested product has no
   * curated `equivalenceClassId`. Computed upstream (the API route), not here: this module
   * stays a pure function over its inputs and never touches the database.
   */
  structuralCandidateProductIds?: number[];
};

export type UserContext = {
  favouriteProductIds: Set<number>;
  /** bought 3+ times — a weaker preference than an explicit favourite */
  inferredFavouriteProductIds: Set<number>;
  blockedProductIds: Set<number>;
  blockedBrands: Set<string>;
  preferPrivateLabel: boolean;
  /** the shopper actually carries the loyalty cards */
  hasLoyaltyCards: boolean;
};

/** Machine-readable: the UI turns this into a Romanian sentence, not this module. */
export type ResolutionReason = {
  code:
    | "EXACT_MATCH"
    | "SUBSTITUTED_SAME_BRAND"
    | "SUBSTITUTED_EQUIVALENT"
    | "SUBSTITUTED_STRUCTURAL"
    | "SUBSTITUTED_CHEAPEST"
    | "SPLIT_PACKS"
    | "NOT_STOCKED"
    | "EXACT_ONLY_NOT_STOCKED"
    | "ALL_CANDIDATES_EXCLUDED";
  /** what the shopper asked for */
  requestedProductName?: string;
  /** what they would get instead */
  chosenProductName?: string;
  /** per canonical unit, so "cheaper by X lei/kg" is expressible */
  requestedUnitPriceBani?: Bani;
  chosenUnitPriceBani?: Bani;
  savingPerUnitBani?: Bani;
  /** why candidates were dropped, for the review UI */
  excluded?: { blocked: number; stale: number; expired: number; anomaly: number };
  /** set when the plan uses several packs */
  packs?: number;
};

export type Resolution = {
  status: "EXACT" | "SUBSTITUTED" | "UNAVAILABLE";
  offer: OfferLike | null;
  /** supports 2×500 g for a 1 kg request */
  quantityPlan: { offerId: number; units: number }[];
  totalBani: Bani;
  reason: ResolutionReason;
  alternatives: OfferLike[];
};

/**
 * Effective unit price in bani, honouring bulk tiers.
 *
 * Denominated per KILOGRAM / LITRE / PIECE — the units a shopper actually compares — not
 * per gram or millilitre. That is not cosmetic: at bani-per-millilitre, 550 bani/L and
 * 700 bani/L both round to 1, and integer money would rank a 27%-cheaper milk as equal.
 */
export function unitPriceBani(o: OfferLike, unitsNeeded = 1): Bani {
  const packs = Math.max(1, Math.ceil(unitsNeeded / o.packQuantity));
  let best = o.priceBani;
  for (const t of o.bulkTiers ?? []) {
    if (packs >= t.qty && t.priceBani < best) best = t.priceBani;
  }
  if (o.packQuantity <= 0) return best;
  // G and ML are milli-units: divide by packQuantity/1000 to price per kg / per litre.
  const divisor = o.unit === "buc" || o.unit === "BUC" ? o.packQuantity : o.packQuantity / 1000;
  return Math.round(best / divisor);
}

/** Total cost in bani of buying `packs` of this offer, honouring bulk tiers. */
export function totalForPacks(o: OfferLike, packs: number): Bani {
  let per = o.priceBani;
  for (const t of o.bulkTiers ?? []) {
    if (packs >= t.qty && t.priceBani < per) per = t.priceBani;
  }
  return per * packs;
}

export function isBuyable(o: OfferLike, ctx: UserContext, now: Date): { ok: boolean; why?: keyof NonNullable<ResolutionReason["excluded"]> } {
  if (ctx.blockedProductIds.has(o.product.id)) return { ok: false, why: "blocked" };
  if (o.product.brand && ctx.blockedBrands.has(o.product.brand.toLowerCase())) return { ok: false, why: "blocked" };
  if (o.hasUnresolvedAnomaly) return { ok: false, why: "anomaly" };
  // stale = we stopped seeing it; expired = its promo window closed. Both make the price
  // untrustworthy, but for different reasons and with different user-facing copy.
  if (o.isStale) return { ok: false, why: "stale" };
  if (o.isExpired || (o.promoValidTo && o.promoValidTo.getTime() < now.getTime())) return { ok: false, why: "expired" };
  if (o.availability !== "in stock") return { ok: false, why: "stale" };
  return { ok: true };
}

/** Which pool of candidates actually produced the match, so `resolveLine` can label the
 *  curated-class case and the structural-fallback case differently — the second is weaker
 *  evidence (see structural-equivalence.ts) and must not read as equally certain. */
type CandidateTier = "DIRECT" | "CLASS" | "STRUCTURAL";

/** Candidate set for a line, by mode. */
function candidatesFor(line: ListLine, requested: OfferLike | undefined, all: OfferLike[]): { offers: OfferLike[]; tier: CandidateTier } {
  const pinned = line.pinnedProductId ?? line.productId;
  switch (line.substitutionMode) {
    case "EXACT":
      return { offers: all.filter((o) => o.product.id === pinned), tier: "DIRECT" };
    case "SAME_BRAND": {
      const brand = requested?.product.brand?.toLowerCase();
      if (!brand) return { offers: all.filter((o) => o.product.id === pinned), tier: "DIRECT" };
      return { offers: all.filter((o) => o.product.brand?.toLowerCase() === brand), tier: "DIRECT" };
    }
    case "EQUIVALENT": {
      const cls = requested?.product.equivalenceClassId;
      if (cls != null) return { offers: all.filter((o) => o.product.equivalenceClassId === cls), tier: "CLASS" };
      // No curated class. Fall back to the caller's precomputed structural candidates — same
      // head noun, canonical unit, size band — rather than giving up, but this is weaker
      // evidence than a human-curated class and `resolveLine` tags it as such.
      if (line.structuralCandidateProductIds?.length) {
        const set = new Set(line.structuralCandidateProductIds);
        set.add(pinned);
        return { offers: all.filter((o) => set.has(o.product.id)), tier: "STRUCTURAL" };
      }
      return { offers: all.filter((o) => o.product.id === pinned), tier: "DIRECT" };
    }
    case "CHEAPEST": {
      const cls = requested?.product.equivalenceClassId;
      if (cls == null) return { offers: all.filter((o) => o.product.id === pinned), tier: "DIRECT" };
      return { offers: all.filter((o) => o.product.equivalenceClassId === cls), tier: "CLASS" };
    }
  }
}

/** Rank survivors: favourites first, then private label if preferred, then unit price. */
export function rank(cands: OfferLike[], ctx: UserContext, unitsNeeded: number): OfferLike[] {
  return [...cands].sort((a, b) => {
    const fav = (o: OfferLike) => (ctx.favouriteProductIds.has(o.product.id) ? 0 : ctx.inferredFavouriteProductIds.has(o.product.id) ? 1 : 2);
    if (fav(a) !== fav(b)) return fav(a) - fav(b);
    if (ctx.preferPrivateLabel && a.product.isPrivateLabel !== b.product.isPrivateLabel) {
      return a.product.isPrivateLabel ? -1 : 1;
    }
    return unitPriceBani(a, unitsNeeded) - unitPriceBani(b, unitsNeeded);
  });
}

/**
 * Resolve ONE list line at ONE merchant.
 * @param offers every offer this merchant has, already loaded
 */
export function resolveLine(line: ListLine, merchantId: number, ctx: UserContext, offers: OfferLike[], now = new Date()): Resolution {
  const mine = offers.filter((o) => o.merchantId === merchantId);
  const requested = mine.find((o) => o.product.id === (line.pinnedProductId ?? line.productId))
    ?? offers.find((o) => o.product.id === (line.pinnedProductId ?? line.productId));

  // how much of the canonical unit the shopper actually wants
  const unitsNeeded = line.requestedQuantity && line.requestedQuantity > 0
    ? line.requestedQuantity
    : (requested?.packQuantity ?? 1) * line.qty;

  const { offers: raw, tier } = candidatesFor(line, requested, mine);
  const excluded = { blocked: 0, stale: 0, expired: 0, anomaly: 0 };
  const buyable: OfferLike[] = [];
  for (const o of raw) {
    const v = isBuyable(o, ctx, now);
    if (v.ok) buyable.push(o);
    else if (v.why) excluded[v.why]++;
  }

  if (buyable.length === 0) {
    const anyExcluded = Object.values(excluded).some((n) => n > 0);
    return {
      status: "UNAVAILABLE",
      offer: null,
      quantityPlan: [],
      totalBani: 0,
      reason: {
        code: line.substitutionMode === "EXACT" ? "EXACT_ONLY_NOT_STOCKED" : anyExcluded ? "ALL_CANDIDATES_EXCLUDED" : "NOT_STOCKED",
        requestedProductName: requested?.product.name,
        excluded,
      },
      alternatives: [],
    };
  }

  const ranked = rank(buyable, ctx, unitsNeeded);
  const chosen = ranked[0];
  const packs = Math.max(1, Math.ceil(unitsNeeded / chosen.packQuantity));
  const totalBani = totalForPacks(chosen, packs);

  const isExact = chosen.product.id === (line.pinnedProductId ?? line.productId);
  const reqUnit = requested ? unitPriceBani(requested, unitsNeeded) : undefined;
  const chosenUnit = unitPriceBani(chosen, unitsNeeded);

  let code: ResolutionReason["code"];
  if (isExact) code = packs > 1 ? "SPLIT_PACKS" : "EXACT_MATCH";
  else if (line.substitutionMode === "SAME_BRAND") code = "SUBSTITUTED_SAME_BRAND";
  else if (line.substitutionMode === "CHEAPEST") code = "SUBSTITUTED_CHEAPEST";
  else if (tier === "STRUCTURAL") code = "SUBSTITUTED_STRUCTURAL";
  else code = "SUBSTITUTED_EQUIVALENT";

  return {
    status: isExact ? "EXACT" : "SUBSTITUTED",
    offer: chosen,
    quantityPlan: [{ offerId: chosen.id, units: packs }],
    totalBani,
    reason: {
      code,
      requestedProductName: requested?.product.name,
      chosenProductName: chosen.product.name,
      requestedUnitPriceBani: reqUnit,
      chosenUnitPriceBani: chosenUnit,
      savingPerUnitBani: reqUnit != null ? reqUnit - chosenUnit : undefined,
      packs: packs > 1 ? packs : undefined,
      excluded,
    },
    alternatives: ranked.slice(1, 6),
  };
}
