// Cache tags, in one place, because a tag is a string that has to match in two files.
//
// Everything the catalog derives from — prices, offers, category assignments — changes at
// exactly one moment: when the nightly finishes. Not on a timer. So the pages carry a long
// `revalidate` as a backstop and are actually dropped by tag from `npm run revalidate`, which
// the nightly runs as its last step.
//
// A timer alone gets this wrong in both directions: too short and every visitor pays for a
// re-render of data that has not moved; too long and the site shows yesterday's prices with
// today's date on them. Tying it to the scrape is the only version that is right at both ends.

/** Anything derived from products, offers or prices. Dropped when the nightly finishes. */
export const CATALOG_TAG = "catalog";

/** The routes the nightly regenerates by path, on top of the tag. */
export const REVALIDATE_PATHS = ["/", "/oferte", "/index-cosmic", "/despre", "/shrinkflation"] as const;
