// Declarative store adapter — the way to add a store now.
// A store becomes a CONFIG (URLs + a selector/field map), not a bespoke script, and every
// adapter shares the same fetch → parse → normalize → validate pipeline. That means one
// place to fix a locale bug, one place to add retries, and offline fixture tests for all.
import type { StoreProduct } from "../../src/lib/scrape-util";

/**
 * How this merchant's prices reach us. The MERCHANT vocabulary — deliberately NOT the same
 * type as `Offer.priceSource` (SHELF | ONLINE | DELIVERY_PLATFORM | FLYER), which answers a
 * different question: what kind of price it is.
 *
 * These two were both called `priceSource`, and the runner copied one straight into the other.
 * That is how 10,731 offers ended up holding the lowercase merchant word `shelf` in a column
 * whose live readers compared against `SHELF`. The name is now different so the copy cannot be
 * made by accident; `toPriceSource()` is the only crossing.
 */
export type PriceChannel = "shelf" | "delivery" | "aggregator";

/** One listing page to visit, and the catalog category its products belong to. */
export type Route = {
  /**
   * URL, or a template with pagination tokens:
   *   {page}         1, 2, 3 …            — page-number APIs
   *   {from} / {to}  0-49, 50-99 …        — OFFSET APIs (VTEX and friends)
   * Offset tokens need `pageSize` on the adapter. Mixing the two forms is allowed; each
   * token is substituted independently.
   */
  url: string;
  /** catalog category slug for products created from this route */
  cat?: string;
  /** section override (default = adapter.section) */
  section?: string;
};

/** How to pull fields out of a rendered DOM card. First matching selector wins. */
export type DomMap = {
  /** selector for a product card */
  card: string;
  name: string[];
  price: string[];
  /** attribute to read the price from instead of textContent (e.g. "data-price") */
  priceAttr?: { sel: string; attr: string };
  image?: string[];
  link?: string[];
  brand?: { sel: string; attr: string }[];
  ean?: { sel: string; attr: string }[];
  /** selector+attr whose value marks unavailability, plus the value that means it */
  unavailable?: { sel: string; attr: string; equals: string };
};

/** How to pull fields out of a JSON payload (search API / JSON-LD). */
export type JsonMap = {
  /** dot path to the product array inside the response, e.g. "results.0.hits" */
  items: string;
  name: string;
  price: string;
  image?: string;
  link?: string;
  brand?: string;
  ean?: string;
  /** path to a boolean/string that means "in stock" */
  available?: string;
  /** value(s) of `available` that mean out of stock */
  unavailableWhen?: (string | number | boolean)[];
};

export type Adapter = {
  slug: string;
  name: string;
  websiteUrl: string;
  color?: string;
  /** "online" | "hybrid" | "physical" */
  storeType?: string;
  /** where prices come from — delivery apps mark up over shelf */
  priceChannel?: PriceChannel;
  section: string;
  /** create catalog products for pool items that match nothing */
  addNew?: boolean;
  /** "json" is strongly preferred: 10–50× faster than rendering and far less brittle */
  mode: "json" | "dom";
  routes: Route[];
  /** page numbers to walk for templates containing {page} or {from}/{to} */
  maxPages?: number;
  /** rows per request, for {from}/{to} offset pagination. Required if a route uses them. */
  pageSize?: number;
  /** ms between requests — be a good citizen */
  delayMs?: number;
  json?: JsonMap;
  dom?: DomMap;
  /** extra request headers (API keys, app identifiers) */
  headers?: Record<string, string>;
  /** POST body template for search APIs; {page}/{query} are substituted */
  body?: string;
  /** final per-item cleanup (e.g. cl → ml normalization) */
  refine?: (p: StoreProduct) => StoreProduct;
};
