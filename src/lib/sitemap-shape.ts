/**
 * THE SHAPE OF THE SITEMAP, in ONE place.
 *
 * The sitemap is now an index (`app/sitemap.xml/route.ts`) plus chunked children
 * (`app/sitemap.ts`). Both must agree on two things — how many URLs go in a chunk, and which
 * products count as live — or the index advertises a child that does not exist, or omits one
 * that does. Neither failure is visible from inside the app: the index is well-formed either
 * way and every child it DOES list resolves.
 *
 * CLAUDE.md has a rule about exactly this shape ("One vocabulary per column, defined in
 * TypeScript"), written after `Offer.priceSource` held five spellings of a four-value field
 * because two writers disagreed. Two files computing one chunk count is the same defect.
 */

/** URLs per child sitemap. Google's hard limit is 50,000 per file; this also bounds response size. */
export const CHUNK = 10_000;

/**
 * What makes a product worth advertising: a live offer from an active merchant.
 *
 * Listing a product whose every offer has gone stale sends a crawler to a page with no prices
 * on it — a soft 404, which costs crawl budget and trains Google to trust the sitemap less.
 */
export const liveOfferWhere = { isStale: false, merchant: { active: true } } as const;

/**
 * WHICH CATEGORIES THE SITEMAP MAY ADVERTISE, defined once.
 *
 * `/c/[slug]` resolves through `getCategoryPage`, which returns null for anything that is not
 * grocery and makes the route call `notFound()`. Emitting any other section publishes a 404 to
 * search engines — which is exactly what happened, for 246 URLs.
 *
 * `audit:sitemap` used to answer the same question from its own copy of this predicate,
 * commented "copied verbatim from src/app/sitemap.ts". When the sitemap was fixed, the copy was
 * not, and the audit went on reporting 246 dead URLs that no longer existed. A stale check that
 * cries wolf is worse than none: it teaches the reader to ignore the one signal that matters.
 * CLAUDE.md says it plainly — "One vocabulary per column, defined in TypeScript."
 *
 * So both the emitter and the audit import THIS. They can disagree about many things; they can
 * no longer disagree about which categories exist.
 */
export const SITEMAP_SECTION = "grocery";

export const sitemapCategoryWhere = {
  section: SITEMAP_SECTION,
  products: { some: { offers: { some: liveOfferWhere } } },
} as const;
