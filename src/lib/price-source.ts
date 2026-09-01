// What KIND of price an offer is. One vocabulary, one mapper, one place to change it.
//
// This exists because the catalog held FIVE spellings of a four-value field:
//
//     SHELF 13,412   shelf 10,731   ONLINE 10,981   delivery 8,268   FLYER 373
//
// and `DELIVERY_PLATFORM` — the value the schema documented and the optimizer would exclude for
// markup — existed nowhere at all. Both `basket.ts` and `ListBuilder.tsx` compared against the
// string literal `"shelf"`, so 13,412 uppercase SHELF offers took the wrong branch in the live
// optimizer.
//
// THE ROOT CAUSE WAS NOT CASING. `Merchant.priceSource` and `Offer.priceSource` are two
// DIFFERENT FIELDS WITH THE SAME NAME and different vocabularies:
//
//     Merchant.priceSource : "shelf" | "delivery" | "aggregator"   how prices reach us
//     Offer.priceSource    : SHELF | ONLINE | DELIVERY_PLATFORM | FLYER   what kind of price
//
// and `matchPoolToCatalog` used the merchant's value as a FALLBACK for the offer's — copying a
// value across a vocabulary boundary. A shared name made that look like a default rather than a
// translation.
//
// SQLite CANNOT HELP HERE. Prisma refuses enums on SQLite ("the current connector does not
// support enums"), so the column stays a String in the local database and the guarantees are:
//   • this union type, so the fifth spelling does not compile
//   • `toPriceSource`, the only translation from the merchant vocabulary
//   • an audit-db invariant, which reads the database and does not trust any of the above
// The generated Postgres schema declares a real enum, so the cutover adds the database-level
// refusal that SQLite cannot give us.

/** The only values an Offer.priceSource may hold. */
export const PRICE_SOURCES = ["SHELF", "ONLINE", "DELIVERY_PLATFORM", "FLYER"] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];

export function isPriceSource(v: unknown): v is PriceSource {
  return typeof v === "string" && (PRICE_SOURCES as readonly string[]).includes(v);
}

/**
 * Translate the MERCHANT vocabulary into the OFFER vocabulary.
 *
 * `delivery` becomes ONLINE, not DELIVERY_PLATFORM, and the distinction is the whole point:
 * Freshful, Sezamo and DCNeu are first-party online shops that deliver their own stock at their
 * own posted price. A DELIVERY_PLATFORM is Glovo or Tazz reselling another shop's stock at a
 * markup — a different thing, which the optimizer excludes by default. Collapsing the two would
 * either wrongly exclude three real merchants or wrongly include marked-up prices.
 *
 * `aggregator` is the merchant-side word for that, and no merchant currently uses it.
 */
export function toPriceSource(merchantValue: string | null | undefined): PriceSource {
  switch ((merchantValue ?? "").trim().toLowerCase()) {
    case "delivery": return "ONLINE";
    case "aggregator": return "DELIVERY_PLATFORM";
    case "flyer": return "FLYER";
    case "online": return "ONLINE";
    case "shelf": return "SHELF";
    default: return "SHELF";
  }
}

/**
 * Coerce whatever is already stored into the canonical vocabulary.
 *
 * Used by the repair migration and by any read that must tolerate historical rows. It is
 * deliberately NOT used on the write path — writes go through `toPriceSource`, so a new bad
 * value cannot be laundered into looking correct.
 */
export function normalizePriceSource(stored: string | null | undefined): PriceSource {
  const v = (stored ?? "").trim();
  if (isPriceSource(v)) return v;
  return toPriceSource(v);
}

/** Does this price carry a platform markup the shopper did not choose? */
export function isMarkedUpPlatform(s: PriceSource): boolean {
  return s === "DELIVERY_PLATFORM";
}

/** Is this a standing shelf price rather than a time-boxed or online one? */
export function isShelfPrice(s: PriceSource): boolean {
  return s === "SHELF";
}
