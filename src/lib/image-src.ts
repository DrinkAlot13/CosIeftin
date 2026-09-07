// Which of an <img>'s several URL attributes is the actual photograph.
//
// THE BUG THIS EXISTS FOR. Three scrapers read the image like this:
//
//     el.querySelector("img")?.getAttribute("src") || …?.getAttribute("data-src") || ""
//
// `src` first. On a lazy-loading site `src` is the site's own spinner until JavaScript swaps
// the real URL in, and the real URL is sitting in `data-src` the whole time. So the fallback
// was never reached, and what landed in the catalog was
//
//     https://cdn-media.carrefour.ro/media/Carrefour/lazyload/default/AjaxLoader_1.gif
//
// on 851 of Carrefour's 2,165 live products. It returns HTTP 200 and animates forever, so
// `onError` never fires, no liveness check can see it, and every audit counting non-null images
// calls the row complete.
//
// ── THE SPLIT THIS MODULE ENFORCES: THE BROWSER READS, NODE DECIDES.
//
// The obvious fix is to reorder the expression inside `page.evaluate`. That puts the rule in
// browser context, where it cannot import anything, so it has to be copied into every scraper —
// and a rule copied four times is four rules, one of which will be wrong. This project has that
// bug in its history under several names.
//
// So the scraper collects the raw attributes and this decides. Pure, one definition, and
// covered by tests/image-src.test.ts.

import { imageUrlToStore, isPlaceholderImage } from "./placeholder-image";

/** Every attribute a lazy-loader is known to park the real URL in, best first. */
export const LAZY_IMAGE_ATTRS = [
  "data-src",
  "data-original",
  "data-lazy",
  "data-lazy-src",
  "data-srcset",
  "srcset",
  "src",
] as const;

export type ImageAttrs = Partial<Record<(typeof LAZY_IMAGE_ATTRS)[number], string | null>>;

/**
 * The widest candidate in a srcset, or null.
 *
 * `srcset` is `url 320w, url 640w, url 1280w` — or with pixel densities, `url 1x, url 2x`. The
 * last entry is not reliably the largest, so the widths are parsed rather than assumed.
 */
export function pickFromSrcset(srcset: string | null | undefined): string | null {
  if (!srcset) return null;
  let best: { url: string; weight: number } | null = null;
  for (const part of srcset.split(",")) {
    const bits = part.trim().split(/\s+/);
    const url = bits[0];
    if (!url) continue;
    const d = bits[1] ?? "";
    const w = /^(\d+(?:\.\d+)?)([wx])$/.exec(d);
    // No descriptor at all still counts, at the lowest weight — a single-entry srcset is common.
    const weight = w ? (w[2] === "w" ? Number(w[1]) : Number(w[1]) * 1000) : 1;
    if (!best || weight > best.weight) best = { url, weight };
  }
  return best?.url ?? null;
}

/**
 * Resolve a possibly-relative image URL against the site's base.
 *
 * `r.img.startsWith("http") ? r.img : BASE + r.img` is the pattern every scraper used, and it
 * produced `https://www.penny.ro/data:image/jpeg;base64,iVBOR…` — a data: URI glued onto an
 * origin, which the browser refuses outright. `new URL` handles absolute, protocol-relative,
 * root-relative and data: correctly, and returns null when there is nothing to resolve.
 */
export function resolveImageUrl(raw: string | null | undefined, base: string): string | null {
  if (!raw) return null;
  const u = raw.trim();
  if (u === "") return null;
  if (u.toLowerCase().startsWith("data:")) return null; // never glue this onto an origin
  try {
    return new URL(u, base).toString();
  } catch {
    return null;
  }
}

/**
 * THE picture, from whatever the card carried.
 *
 * Prefers the lazy attributes over `src`, and takes `src` only when it is not a known
 * placeholder — a site that does NOT lazy-load has the real URL there, so refusing `src`
 * outright would lose those. Returns a URL fit to store, or null.
 *
 * Null is a legitimate answer. A card with no image we can trust gets none: the placeholder
 * renders honestly, a stored spinner does not.
 */
export function pickImageUrl(attrs: ImageAttrs, base: string): string | null {
  for (const attr of LAZY_IMAGE_ATTRS) {
    const raw = attrs[attr];
    if (!raw) continue;
    const candidate = attr === "srcset" || attr === "data-srcset" ? pickFromSrcset(raw) : raw;
    if (!candidate) continue;
    // A lazy attribute holding a placeholder is not better than the next candidate.
    if (isPlaceholderImage(candidate)) continue;
    const resolved = resolveImageUrl(candidate, base);
    const storable = imageUrlToStore(resolved);
    if (storable) return storable;
  }
  return null;
}
