// WHAT EACH SOURCE CAN ACTUALLY PROVIDE — declared once, so a null can be read.
//
// THE PROBLEM. `Offer.productUrl` is null for two completely different reasons:
//
//   1. The source has no per-product link at all. Kaufland's flyer JSON carries none;
//      Glovo's category tiles have no <a> of their own. Both scrapers set null DELIBERATELY,
//      and both explain why in a comment — Glovo's note records that pointing productUrl at
//      the category page instead tripped the fabrication guard at 71.7%, because the guard
//      groups on (price, productUrl) and every tile in a category then shared both. The guard
//      was right.
//   2. The scraper should have captured one and did not.
//
// In the database those are the same value. Every check downstream therefore agrees with a
// fact nobody established — the shape CLAUDE.md's backlog calls "two kinds of fact", and the
// same shape that let Sezamo ship 9,420 dead links for weeks.
//
// The reason lives in a comment inside each scraper, which is exactly where a check cannot
// reach it. Declaring it here does not change any stored row; it lets an audit ask "is this
// null EXPECTED?" instead of guessing from the percentage.
//
// THIS IS A DECLARATION, NOT A MEASUREMENT. It says what we believe the source offers. When
// `audit:two-kinds` finds the data disagreeing with it, one of the two is wrong and the
// disagreement is the finding.

/** Per-merchant source capabilities, keyed by `Merchant.slug`. */
export type SourceCapabilities = {
  /**
   * Does the SOURCE expose a per-product URL we could store?
   *
   * false means every `productUrl` for this merchant is legitimately null and an audit must
   * not report it as a gap. true means a null is a scraper defect.
   */
  hasProductUrls: boolean;
  /** Why, in one line — so the next person does not have to rediscover it. */
  note: string;
};

export const SOURCE_CAPABILITIES: Record<string, SourceCapabilities> = {
  auchan: { hasProductUrls: true, note: "VTEX catalog API returns a product page per item" },
  carrefour: { hasProductUrls: true, note: "product tiles link to their own page" },
  "mega-image": { hasProductUrls: true, note: "product tiles link to their own page" },
  freshful: { hasProductUrls: true, note: "__NEXT_DATA__ carries a slug per product" },
  metro: { hasProductUrls: true, note: "product tiles link to their own page" },
  sezamo: { hasProductUrls: true, note: "card API returns id + slug; the path is /<id>-<slug>" },
  dcneu: { hasProductUrls: true, note: "each card links to its own product page" },
  farmaciatei: { hasProductUrls: true, note: "each card links to its own product page" },
  penny: { hasProductUrls: true, note: "each card links to its own product page" },
  finestore: { hasProductUrls: true, note: "each card links to its own product page" },
  lemanoir: { hasProductUrls: true, note: "each card links to its own product page" },

  // ── The two that legitimately have none. Both nulls are correct and deliberate.
  kaufland: {
    hasProductUrls: false,
    note: "flyer JSON has no per-product link; pointing at the flyer page would give every offer the same url",
  },
  "glovo-kaufland": {
    hasProductUrls: false,
    note: "category tiles carry no <a>; using the category URL tripped the fabrication guard at 71.7%",
  },
  // Same adapter (scripts/adapters/glovo.ts) as glovo-kaufland, same reason: category tiles
  // carry no <a>, and pointing productUrl at the category page would trip the same fabrication
  // guard. Missing here — not a measurement, an oversight — is exactly the "undeclared merchant"
  // gap probe:links exists to surface rather than silently skip.
  "glovo-penny": {
    hasProductUrls: false,
    note: "category tiles carry no <a>; same fabrication-guard risk as glovo-kaufland",
  },
  "glovo-profi": {
    hasProductUrls: false,
    note: "category tiles carry no <a>; same fabrication-guard risk as glovo-kaufland",
  },
};

/** True when a null `productUrl` for this merchant is expected rather than a defect. */
export function nullProductUrlIsExpected(merchantSlug: string): boolean {
  return SOURCE_CAPABILITIES[merchantSlug]?.hasProductUrls === false;
}

/**
 * ── A SECOND KIND OF "LESS THAN YOU'D EXPECT", AND IT ALSO NEEDS A DECLARATION.
 *
 * A low item count for a merchant reads as a broken scraper. For most merchants it is. For
 * these two it is the actual size of what the source publishes: Penny and Selgros have no
 * browsable online catalog, only a homepage deals/flyer carousel — documented in their own
 * adapters (`scripts/adapters/penny.ts`, `scripts/adapters/selgros.ts`) after someone already
 * checked for a fuller route and found none. A shopper comparing a 20-item cart against ~30-60
 * products sees "1/20" and reasonably reads it as this site being broken, when the honest
 * reading is "this store only ever shows up for a handful of items, by design of their own
 * website, not ours."
 *
 * Declared here rather than left in the adapter comments for the same reason as
 * `SOURCE_CAPABILITIES` above: a comment in a scraper file cannot reach a UI component.
 */
export const LIMITED_CATALOG_MERCHANTS: Record<string, string> = {
  penny: "Penny nu publică un catalog online — doar oferta săptămânii curente (în jur de 30 de produse). Un coș complet aici e puțin probabil.",
  selgros: "Selgros nu publică un catalog online public — doar vitrina de oferte de pe prima pagină (în jur de 50-60 de produse). Catalogul complet există doar cu cont de cumpărător en-gros.",
};

/** The honest-limitation note for this merchant, or null when it publishes a real catalog. */
export function limitedCatalogNote(merchantSlug: string): string | null {
  return LIMITED_CATALOG_MERCHANTS[merchantSlug] ?? null;
}
