// ── THE FOUR NON-NEGOTIABLES, IMPLEMENTED ONCE SO NO ROUTE CAN FORGET ONE.
//
// docs/API.md §2 states them; this file is the only place they are enforced. A route that
// serialises an offer by hand would eventually omit `observedAt`, or leak a withheld row, and
// the reviewer of that route would have no way to see it. Every endpoint calls `serializeOffer`.
//
//   1. Every price carries its own observation date AND a server-computed age.
//   2. Withheld rows never appear; stale / out-of-stock / delivery-platform are FLAGGED.
//   3. "No comparison" is a shape, not an empty array.
//   4. A deep link is the real one or an explicit null with a reason — never a homepage.
//
// See CLAUDE.md, "A PEER-RELATIVE CHECK FLAGS DISAGREEMENT, NOT GUILT" and the display rules:
// this is the display layer for a client we do not control, which makes it stricter, not looser.

import { nullProductUrlIsExpected } from "@/lib/source-capabilities";
import { isDeliveryPlatform } from "@/lib/platform/visibility";
import { cardSavingBani, requiresCard } from "@/lib/loyalty";
import { formatBani } from "@/lib/price/parsePrice";

/** Anything with enough of an Offer on it to be published. */
export type OfferLike = {
  id: number;
  price: number;
  priceBani: number | null;
  pricePerUnit: number | null;
  pricePerUnitBani: number | null;
  availability: string;
  isStale: boolean;
  flagged: boolean;
  priceSource: string;
  productUrl: string | null;
  url: string;
  lastObservedAt: Date | null;
  requiresLoyaltyCard: boolean;
  loyaltyPriceBani: number | null;
  packLabel?: string | null;
  merchant: { slug: string; name: string; storeType?: string | null };
};

export type SerializedOffer = ReturnType<typeof serializeOffer>;

const HOUR = 3_600_000;

export function serializeOffer(o: OfferLike, now = Date.now()) {
  const bani = o.priceBani ?? Math.round(o.price * 100);
  const observedAt = o.lastObservedAt ?? null;

  return {
    merchant: { slug: o.merchant.slug, name: o.merchant.name, storeType: o.merchant.storeType ?? null },

    priceBani: bani,
    price: formatBani(bani),
    unitPriceBani: o.pricePerUnitBani ?? (o.pricePerUnit ? Math.round(o.pricePerUnit * 100) : null),

    // ── 1. WHEN THIS WAS CHECKED. `observedAgeHours` is redundant on purpose: a client that
    // forgets to compute it renders "acum" for a six-day-old price, which is the failure the
    // field exists to stop. Null when we genuinely never recorded a date — never 0, which would
    // read as "just now" and is this project's most repeated defect.
    observedAt: observedAt ? observedAt.toISOString() : null,
    observedAgeHours: observedAt ? Math.round(((now - observedAt.getTime()) / HOUR) * 10) / 10 : null,

    // ── 2. FLAGS, so nothing is silently mixed.
    availability: o.availability,
    inStock: o.availability === "in stock",
    isStale: o.isStale,
    priceSource: o.priceSource,
    isDeliveryPlatform: isDeliveryPlatform(o),

    // A card price is not a price everyone can pay — see lib/loyalty.ts. `requiresLoyaltyCard`
    // means THIS price needs the card; `loyaltyPriceBani` is a cheaper card price alongside it.
    requiresLoyaltyCard: requiresCard(o),
    loyaltyPriceBani: cardSavingBani({ ...o, merchant: o.merchant }) != null ? o.loyaltyPriceBani : null,

    // ── 4. THE DEEP LINK, or an explicit absence with its reason.
    productUrl: o.productUrl,
    productUrlAbsent: o.productUrl
      ? null
      : nullProductUrlIsExpected(o.merchant.slug)
        ? "merchant-publishes-none"
        : "unknown",

    packLabel: o.packLabel ?? null,
  };
}

/**
 * ── 2 (the hard half). WITHHELD ROWS NEVER LEAVE THE BUILDING.
 *
 * `flagged` means a gate refused to trust the price, the match, or both. There is no query
 * parameter that returns them: an API that can emit them invites a client to render them, and
 * the client has none of the context that would let it decide. The website's own item page
 * already refuses them; a contract handed to software we do not control refuses them harder.
 *
 * Delivery-platform rows are a different case — real prices with a measured +11.5% median
 * markup — so they are excluded by DEFAULT and returnable on request, flagged either way.
 */
export function publishableOffers<T extends OfferLike>(offers: T[], includeDeliveryPlatform: boolean): T[] {
  return offers
    .filter((o) => !o.flagged)
    .filter((o) => includeDeliveryPlatform || !isDeliveryPlatform(o));
}

export type ComparisonStatus = "comparable" | "single-shop" | "no-price";

/**
 * ── 3. "WE DO NOT HAVE A COMPARISON FOR THIS" IS A FIRST-CLASS ANSWER.
 *
 * 89.3% of priced grocery products have exactly ONE shop. That is the common case, not an edge
 * one, and a client left to infer it from `offers.length` will render a price list of one as
 * though it were a comparison. The status says which of the three worlds this product is in and
 * carries Romanian copy the client can print unchanged.
 */
export function comparisonOf(offers: { merchant: { slug: string }; inStock?: boolean }[]): {
  status: ComparisonStatus;
  shopCount: number;
  reason: string;
} {
  const shops = new Set(offers.map((o) => o.merchant.slug));
  if (shops.size === 0) {
    return { status: "no-price", shopCount: 0, reason: "Nu avem niciun preț curent pentru acest produs." };
  }
  if (shops.size === 1) {
    return { status: "single-shop", shopCount: 1, reason: "Doar un magazin are un preț pentru acest produs acum." };
  }
  return { status: "comparable", shopCount: shops.size, reason: `Prețuri din ${shops.size} magazine.` };
}

/** The product half of a response. Slugs, never internal ids — see docs/API.md §4. */
export function serializeProduct(p: {
  slug: string; name: string; brand: string | null;
  unit: string | null; unitSize: number | null; image: string | null; section: string;
  category?: { slug: string; name: string } | null;
}) {
  return {
    slug: p.slug,
    name: p.name,
    brand: p.brand,
    unit: p.unit,
    unitSize: p.unitSize,
    image: p.image,
    section: p.section,
    category: p.category ? { slug: p.category.slug, name: p.category.name } : null,
  };
}

/** Cheapest / dearest across what we are actually publishing. */
export function summaryOf(offers: SerializedOffer[]) {
  const live = offers.filter((o) => o.inStock && !o.isStale).map((o) => o.priceBani);
  const pool = live.length > 0 ? live : offers.map((o) => o.priceBani);
  if (pool.length === 0) return { lowestBani: null, highestBani: null, savingsBani: null };
  const lowest = Math.min(...pool);
  const highest = Math.max(...pool);
  return { lowestBani: lowest, highestBani: highest, savingsBani: highest - lowest };
}
