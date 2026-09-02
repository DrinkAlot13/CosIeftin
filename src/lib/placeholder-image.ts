// Which stored image URLs are not product photographs.
//
// THE BUG THIS EXISTS FOR. A card on /alcool showed a permanent animated shimmer instead of a
// bottle. It was not a CSS loading state and no timeout would ever have cleared it: the scraper
// read the `<img src>` BEFORE the site's lazy-loader swapped in the real URL, so what landed in
// the catalog was Carrefour's own spinner —
//
//     https://cdn-media.carrefour.ro/media/Carrefour/lazyload/default/AjaxLoader_1.gif
//
// It resolves, returns HTTP 200 and animates forever, so `onError` can never fire and a
// broken-image check can never see it. 962 products across the catalog store one of these:
// 870 Carrefour spinners (40.7% of Carrefour's live products) and 92 DCNeu placeholders.
//
// One definition, used by BOTH the renderer and `audit:images`. If the two disagreed we would
// be showing spinners the audit reports as fixed — the same shape of bug as two definitions of
// "outlier" returning 47 and 7 for the same catalog.
//
// The fix at the scraper is a separate, larger job (it needs `data-src` handling per site and a
// re-scrape); this stops the site from displaying them in the meantime. The rows are NOT
// deleted — a wrong image is still evidence of what the scraper read.

/** Substrings that identify a site's own loading/placeholder asset rather than a product photo. */
const PLACEHOLDER_MARKERS = [
  "lazyload",
  "ajaxloader",
  "/loader",
  "loader.gif",
  "spinner",
  "placeholder",
  "no-image",
  "noimage",
  "no_image",
  "default-image",
  "blank.gif",
  "dummy",
];

/**
 * True when this URL is known not to be a product photograph.
 *
 * Deliberately conservative: it matches the site's own asset paths, not anything merely
 * suspicious. A false positive costs a real photo and shows a name placeholder instead, which
 * is a worse outcome than it sounds — so the list stays short and evidence-driven, and every
 * entry here was observed in the live catalog.
 */
export function isPlaceholderImage(url: string | null | undefined): boolean {
  if (!url) return true;
  const u = url.trim();
  if (u === "") return true;
  const low = u.toLowerCase();
  return PLACEHOLDER_MARKERS.some((m) => low.includes(m));
}

/** A URL we are willing to put in an `<img src>`, or null. */
export function usableImageUrl(url: string | null | undefined): string | null {
  return isPlaceholderImage(url) ? null : (url as string);
}
