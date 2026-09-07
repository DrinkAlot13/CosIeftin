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

/**
 * A URL we are willing to put in an `<img src>`, or null.
 *
 * THE SAME GATE THE WRITER USES. This used to be `isPlaceholderImage` alone, which is a
 * narrower question — so a URL the ingest would refuse could still be rendered, and two rows
 * holding `https://www.penny.ro/data:image/jpeg;base64,…` reached the page and were refused by
 * the browser instead (ERR_BLOCKED_BY_ORB, a guaranteed blank card).
 *
 * One question, one answer. Rows already in the database are cleaned on their merchant's next
 * run; until then the renderer refuses them here rather than emitting an `<img>` that cannot
 * load.
 */
export function usableImageUrl(url: string | null | undefined): string | null {
  return imageUrlToStore(url);
}

/**
 * ── THE WRITE-TIME GATE. A placeholder stored as a product image is worse than null.
 *
 * Null renders honestly: the card shows the product's name and says "fără imagine". A stored
 * spinner renders a lie — it returns HTTP 200 and animates forever, so `onError` never fires,
 * no liveness check can see it, and the row looks complete to every audit that counts non-null
 * images. 851 of Carrefour's 2,165 live products carry one.
 *
 * So the rejection moves to the write. `isPlaceholderImage` is the shared vocabulary; this adds
 * the malformed shapes that only ever appear at ingest:
 *
 *   • a data: URI resolved against the site's origin. Observed live:
 *     `https://www.penny.ro/data:image/jpeg;base64,iVBOR…` — a scraper joined a relative-URL
 *     base onto something that was already absolute. The browser refuses it outright
 *     (ERR_BLOCKED_BY_ORB), so it is a guaranteed blank card.
 *   • a bare data: URI. Usually the lazy-loader's inline 1x1 shim, and even when it is a real
 *     thumbnail we will not put kilobytes of base64 in a database column.
 *   • anything that is not http(s) or one of our own absolute paths.
 *
 * Returns the URL to store, or null. NULL IS A LEGITIMATE ANSWER and must not be replaced by a
 * guess: an absent image is a question, an invented one is an answer nobody checked.
 */
export function imageUrlToStore(url: string | null | undefined): string | null {
  if (!url) return null;
  const u = url.trim();
  if (u === "") return null;
  if (isPlaceholderImage(u)) return null;

  // Our own self-hosted path.
  if (u.startsWith("/")) return u;

  // A data: URI, bare or wrongly joined onto an origin.
  const low = u.toLowerCase();
  if (low.startsWith("data:")) return null;
  if (low.includes("/data:image") || low.includes("/data%3aimage")) return null;

  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  // A path that is only a slash carries no file: it is the merchant's home page, not a picture.
  if (parsed.pathname === "" || parsed.pathname === "/") return null;
  return u;
}
