// Recovering the category a MERCHANT already told us, from data we already stored.
//
// 58.9% of grocery products carry no category, and the instinct is to infer one from the product
// name. That is the expensive, error-prone half. Before doing any of it: four merchants have
// been telling us their own category on every offer, and we have been throwing it away at the
// mapper. A merchant-supplied category is better than anything we can infer, and it is free.
//
// WHERE IT WAS HIDING, per merchant:
//
//   auchan      rawSourceBlob."categories"  — VTEX ships three levels plus stable numeric ids:
//               ["/Lactate si oua/Oua/Oua de gaina/", "/Lactate si oua/Oua/", "/Lactate si oua/"]
//               Present in 298 of 300 sampled blobs even though the blob is TRUNCATED at exactly
//               4096 bytes — the array sits early enough in the VTEX record to survive the cap.
//   mega-image  productUrl — the path itself is the breadcrumb:
//               /Lactate-si-oua/Lapte-proaspat/Lapte-proaspat-semidegresat/<product>/p/39620
//   freshful    rawSourceBlob."breadcrumbs" — three levels with codes.
//   dcneu       Offer.categoryPath — already stored, already two-level, still unused.
//
// UPDATE 2026-09-02 — the scraper change happened. Metro, Sezamo and Carrefour publish nothing
// usable in a URL or a blob, but their scrapers ITERATE a category list to find products and
// were dropping it before the write: the DCNeu pattern one layer earlier. They now persist
// `Offer.categoryPath` like DCNeu does, so recovery is generic rather than per-merchant, and
// Mega Image, Le Manoir, Finestore, Carrefour-alcohol and Glovo came along with them.

import { normalizeRo } from "../text/normalizeRo";

export type RecoveredPath = {
  /** Levels, outermost first, as the merchant words them. */
  levels: string[];
  /** Which merchant field it came from — for the audit, so a bad mapping is traceable. */
  source: "auchan-blob" | "mega-url" | "freshful-blob" | "dcneu-path" | "merchant-path";
};

/** Slug segments that are not categories: the product itself, and routing noise. */
const MEGA_SKIP = new Set(["p", "c", "produs", "product"]);

export type OfferForRecovery = {
  merchantSlug: string;
  rawSourceBlob: string | null;
  productUrl: string | null;
  url: string | null;
  categoryPath: string | null;
};

/**
 * Pull the merchant's own category path off one offer, or null.
 *
 * Deliberately tolerant of malformed input and deliberately silent about it: this runs over
 * every offer in the catalog and a single unparseable blob is not an error, it is one offer we
 * cannot recover. The COUNT of those is what matters, and the audit reports it.
 */
export function recoverPath(o: OfferForRecovery): RecoveredPath | null {
  switch (o.merchantSlug) {
    case "auchan": {
      if (!o.rawSourceBlob) return null;
      // The blob is truncated mid-JSON, so it cannot be parsed — read the array textually.
      const m = /"categories"\s*:\s*\[([^\]]*)\]/.exec(o.rawSourceBlob);
      if (!m) return null;
      const paths = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
      if (paths.length === 0) return null;
      // VTEX lists deepest first; the longest path is the full one.
      const deepest = paths.reduce((a, b) => (b.split("/").filter(Boolean).length > a.split("/").filter(Boolean).length ? b : a));
      const levels = deepest.split("/").map((s) => s.trim()).filter(Boolean);
      return levels.length ? { levels, source: "auchan-blob" } : null;
    }

    case "mega-image": {
      const u = o.productUrl ?? o.url;
      if (!u) return null;
      let path: string;
      try { path = new URL(u, "https://www.mega-image.ro").pathname; } catch { path = u; }
      const segs = path.split("/").map((s) => s.trim()).filter(Boolean);
      // Everything before the "/p/<id>" tail is category; the last of those is the product.
      const pIdx = segs.findIndex((s) => MEGA_SKIP.has(s.toLowerCase()));
      const head = pIdx > 0 ? segs.slice(0, pIdx) : segs;
      // Drop the product slug itself — the segment immediately before /p/.
      const levels = head.slice(0, Math.max(0, head.length - 1)).map((s) => s.replace(/-/g, " "));
      return levels.length ? { levels, source: "mega-url" } : null;
    }

    case "freshful": {
      if (!o.rawSourceBlob) return null;
      try {
        const j = JSON.parse(o.rawSourceBlob) as { breadcrumbs?: { name?: string }[] };
        const levels = (j.breadcrumbs ?? []).map((b) => (b?.name ?? "").trim()).filter(Boolean);
        return levels.length ? { levels, source: "freshful-blob" } : null;
      } catch { return null; }
    }

    case "dcneu": {
      if (!o.categoryPath) return null;
      const levels = o.categoryPath.split("/").map((s) => s.trim()).filter(Boolean);
      return levels.length ? { levels, source: "dcneu-path" } : null;
    }

    // ANY MERCHANT THAT STORES ITS OWN PATH IS RECOVERABLE, WITHOUT A CASE HERE.
    //
    // `default: return null` was the whole trap: a scraper could start supplying a perfectly
    // good category and this function would silently discard it because nobody remembered to
    // add a case. That is the same shape as `toPriceSource` returning SHELF from its default
    // branch and quietly mislabelling 2,217 offers — a default that swallows a valid value.
    //
    // So the fallback READS THE DATA rather than the merchant name. Slug separators become
    // spaces so the mapper sees words ("lactate-si-oua" → "lactate si oua"); a merchant that
    // supplies nothing still yields null, which is the honest answer.
    default: {
      if (!o.categoryPath) return null;
      const levels = o.categoryPath
        .split("/")
        .map((s) => s.trim().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim())
        .filter(Boolean);
      return levels.length ? { levels, source: "merchant-path" } : null;
    }
  }
}

/** A stable key for "this merchant path", for building the mapping table. */
export function pathKey(p: RecoveredPath): string {
  return p.levels.map((l) => normalizeRo(l)).join(" / ");
}
