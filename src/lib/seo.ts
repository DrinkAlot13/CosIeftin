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

/**
 * The canonical origin. Absolute URLs are required in JSON-LD and sitemaps, and a wrong one
 * points Google at a domain we do not own — so this is read from the environment and falls
 * back to localhost, which is obviously wrong in production rather than quietly wrong.
 */
export function siteUrl(): string {
  const raw = process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

export const abs = (path: string): string => `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`;

type OfferLike = {
  price: number;
  priceBani?: number | null;
  availability: string | null;
  url: string | null;
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
  const usable = offers.filter((o) => o.price > 0);
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

export function websiteJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "CoșMic",
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
