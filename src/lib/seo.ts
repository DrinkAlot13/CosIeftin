// SEO helpers: the site's canonical origin, and schema.org JSON-LD builders.
//
// ONE RULE GOVERNS THIS FILE: structured data must be true.
//
// A price comparator's rich result IS its search listing — Google renders the price range
// straight from what we publish here. Emitting a GTIN we do not have, an availability we did
// not observe, or a price we cannot stand behind is not an SEO trick that might not pay off;
// it is a false statement about a real merchant's real price, published in Google's results
// with our name on it. Every field below is either read from a real observation or omitted.
//
// Not one Romanian grocery merchant publishes a GTIN (Mega Image's "valid EANs" turned out to
// be Unix timestamps), so `gtin13` is emitted only where an EAN survived checksum validation.

import { parseEan } from "./product/ean";

// The origin lives in lib/config/siteUrl.ts. It used to be resolved here AND in
// notify-alerts.ts, with different fallbacks — localhost in one, https://cosmic.ro in the
// other. Two answers for one question means one of them is wrong.
import { siteUrl, absoluteUrl } from "./config/siteUrl";

export { siteUrl };
/** Absolute URL for a path on this site. Kept as `abs` because callers already use that name. */
export const abs = absoluteUrl;

type OfferLike = {
  price: number;
  priceBani?: number | null;
  availability: string | null;
  url: string | null;
  /** Needed so a DELIVERY_PLATFORM price cannot reach Google as this product's low. */
  priceSource?: string | null;
  merchant: { name: string };
};

type ProductLike = {
  name: string;
  slug: string;
  brand?: string | null;
  ean?: string | null;
  image?: string | null;
  description?: string | null;
};

/**
 * schema.org Product with an AggregateOffer.
 *
 * AggregateOffer rather than a list of Offers because that is what this page actually is: one
 * product, many merchants, a real low and a real high. `offerCount` counts only offers we
 * would show a shopper.
 */
export function productJsonLd(product: ProductLike, offers: OfferLike[]): Record<string, unknown> | null {
  // ── PLATFORM PRICES ARE EXCLUDED FROM STRUCTURED DATA, DELIBERATELY.
  //
  // The item page now LISTS delivery-platform offers (Phase 3), because a shopper who can order
  // Kaufland through Glovo is looking at a real option. Google is not that shopper: it renders a
  // price range in a search result with no room for "nu este prețul de la raft", and a Glovo
  // price surfacing there as this product's low would be the exact claim `isCurrent` exists to
  // prevent, made somewhere we cannot label it.
  //
  // So the page shows them and the structured data does not. The two are answering different
  // questions and this is the one place they are allowed to differ.
  const usable = offers.filter((o) => o.price > 0 && (o.priceSource ?? "") !== "DELIVERY_PLATFORM");
  if (usable.length === 0) return null; // a product with no price makes no honest Offer

  // Compared in bani so the range Google renders cannot disagree with the page by a rounding
  // step, and so this path exercises the integer column like every other comparison.
  const baniOf = (o: OfferLike): number => o.priceBani ?? Math.round(o.price * 100);
  const lowBani = Math.min(...usable.map(baniOf));
  const highBani = Math.max(...usable.map(baniOf));
  const low = lowBani / 100;
  const high = highBani / 100;
  const anyInStock = usable.some((o) => o.availability === "in stock");

  const node: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    url: abs(`/p/${product.slug}`),
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "RON",
      lowPrice: low.toFixed(2),
      highPrice: high.toFixed(2),
      offerCount: usable.length,
      // Only two states are honest here: we saw stock somewhere, or we did not see any.
      availability: anyInStock
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      seller: [...new Set(usable.map((o) => o.merchant.name))].map((name) => ({
        "@type": "Organization",
        name,
      })),
    },
  };

  if (product.brand) node.brand = { "@type": "Brand", name: product.brand };
  if (product.image) node.image = product.image.startsWith("http") ? product.image : abs(product.image);
  if (product.description) node.description = product.description;

  // A GTIN is a claim about a specific physical product. Emit it only when it validates.
  const ean = parseEan(product.ean ?? null);
  if (ean) node.gtin13 = ean;

  return node;
}

export function breadcrumbJsonLd(trail: { name: string; path: string }[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((t, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: t.name,
      item: abs(t.path),
    })),
  };
}

/**
 * Recipe structured data (schema.org/Recipe). Honest limitation: Google's rich-result
 * eligibility for recipes specifically wants an `image`, which these recipes do not have (each
 * carries only an emoji, not a photo) — so this is valid structured data, not a guarantee of a
 * rich snippet. Fixing that is a content gap (real photos), not a code gap.
 */
export function recipeJsonLd(recipe: { slug: string; name: string; note: string; ingredients: { label: string }[] }): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: recipe.name,
    description: recipe.note,
    url: abs(`/retete#${recipe.slug}`),
    recipeIngredient: recipe.ingredients.map((i) => i.label),
    inLanguage: "ro-RO",
  };
}

export function websiteJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "CosIeftin",
    url: siteUrl(),
    inLanguage: "ro-RO",
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${siteUrl()}/search?q={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  };
}

/**
 * Serialise for a <script type="application/ld+json">.
 *
 * `<` is escaped because a product name containing "</script>" would otherwise close the tag
 * and inject markup. Product names come from scraped merchant pages, which makes them
 * untrusted input by definition.
 */
export function jsonLdScript(node: Record<string, unknown>): string {
  return JSON.stringify(node).split("<").join("\\u003c");
}
