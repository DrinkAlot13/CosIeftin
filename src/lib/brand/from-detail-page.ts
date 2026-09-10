// ── READ A PRODUCT'S BRAND OFF ITS OWN DETAIL PAGE. ONE IMPLEMENTATION.
//
// Used by `probe:brand` (which measures whether a brand is published) and by
// `backfill:detail-brands` (which writes what it finds). Those must never disagree: a probe that
// reports 100% coverage using a different reader than the backfill uses is measuring a rule
// nobody will run. CLAUDE.md has three worked examples of what a restated concept does.
//
// ── ORDER MATTERS, AND GETTING IT WRONG COST A MEASUREMENT.
//
// The rules run precise-first. When the loose spec-row rule ran ahead of the precise brand-link
// rule it matched Sezamo's basket widget and returned "local0 bucati in cos" for 12 of 40 pages —
// short-circuiting the clean answer sitting on the same page. **A loose rule placed ahead of a
// precise one does not merely add noise, it HIDES the precise one**, and it does so silently,
// looking exactly like the page not publishing a brand.

import type { Page } from "playwright";

const PLACEHOLDER = new Set([
  "", "-", "--", "n/a", "na", "null", "undefined", "none", "no brand",
  "fara marca", "generic", "altele", "diverse",
]);

/** A value that is not a brand: a placeholder, a parenthetical, or a basket widget's text. */
export function isNotABrand(v: string): boolean {
  const t = v.trim().toLowerCase();
  if (PLACEHOLDER.has(t) || t.length < 2 || t.length > 60) return true;
  if (/^\(.*\)$/.test(t)) return true;
  return /coş|cos|bucat|cantitate|adauga|pret|lei\b/i.test(t) && /\d/.test(t);
}

export type BrandHit = { where: string; value: string } | null;

/**
 * Read the brand from a loaded product page.
 *
 * Returns null when nothing on the page names one — which is a real answer, not a failure.
 */
export async function brandFromDetailPage(page: Page): Promise<BrandHit> {
  // 1. JSON-LD Product.brand. Written for Google, so it is the most stable thing on the page,
  //    and on Carrefour it is the field that is RIGHT where the listing attribute is wrong.
  const ld = await page.evaluate(() =>
    [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent ?? ""),
  );
  for (const block of ld) {
    if (!/"@type"\s*:\s*"?Product"?/i.test(block)) continue;
    const obj = block.match(/"brand"\s*:\s*\{[^}]*?"name"\s*:\s*"([^"]{2,60})"/i)?.[1];
    if (obj && !isNotABrand(obj)) return { where: "json-ld brand.name", value: obj.trim() };
    const str = block.match(/"brand"\s*:\s*"([^"]{2,60})"/i)?.[1];
    if (str && !isNotABrand(str)) return { where: "json-ld brand", value: str.trim() };
  }

  // 2. A meta tag naming a brand.
  //
  // Returns a PAIR rather than a joined string. The joined version split on a space, which took
  // the first word of every multi-word brand — "Julius Meinl" became "Julius", "Kaiser Franz
  // Josef" became "Kaiser". A truncated brand is not a smaller error than a wrong one: it is a
  // different brand, and it goes into the same matcher gate.
  const meta = await page.evaluate(() => {
    for (const m of document.querySelectorAll("meta")) {
      const p = (m.getAttribute("property") ?? m.getAttribute("name") ?? "").toLowerCase();
      if (/brand|marca|manufacturer/.test(p)) {
        const c = (m.getAttribute("content") ?? "").trim();
        if (c) return { key: p, value: c };
      }
    }
    return null;
  });
  if (meta && !isNotABrand(meta.value)) return { where: `meta ${meta.key}`, value: meta.value };

  // 3. A LINK to the brand's own listing page. This is how Sezamo publishes it — 37 of 40.
  const link = await page.evaluate(() => {
    for (const a of document.querySelectorAll("a[href]")) {
      const h = a.getAttribute("href") ?? "";
      if (/\/(brand|brands|marca|marci)\//i.test(h) || /[?&]brand=/i.test(h)) {
        const t = (a.textContent ?? "").trim();
        if (t.length >= 2 && t.length <= 40) return t;
      }
    }
    return null;
  });
  if (link && !isNotABrand(link)) return { where: "brand link", value: link };

  // 4. A spec row whose LABEL says brand. The loose one, and therefore last of the DOM rules.
  const spec = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("tr, dl > div, [class*='spec'], [class*='attribute'], [class*='param']")];
    for (const r of rows) {
      const t = (r.textContent ?? "").replace(/\s+/g, " ").trim();
      if (t.length > 80) continue;
      if (/^(brand|marca|marcă|producator|producător|manufacturer)\b/i.test(t)) return t;
    }
    return null;
  });
  if (spec) {
    const v = spec.replace(/^(brand|marca|marcă|producator|producător|manufacturer)\s*:?\s*/i, "").trim();
    if (v && !isNotABrand(v)) return { where: "spec row", value: v };
  }

  // 5. Any embedded JSON payload carrying a brand key.
  const payload = await page.evaluate(() => {
    const html = document.documentElement.innerHTML;
    const m = html.match(/["'](?:brand|brandName|manufacturerName|marca)["']\s*:\s*["']([^"']{2,50})["']/i);
    return m ? m[1] : null;
  });
  if (payload && !isNotABrand(payload)) return { where: "embedded json", value: payload.trim() };

  return null;
}
