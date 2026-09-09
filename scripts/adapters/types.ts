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

/**
 * Resolve this adapter's routes at RUN TIME, from the site itself.
 *
 * For a source whose URLs carry a calendar week, a season or a campaign id, a route written
 * into the config is a route with an expiry date nobody set a reminder for. Penny's was pinned
 * to `oferte-site-kw35`; when week 35 ended the URL began 404ing and the scraper read nothing,
 * every week, silently. Asking the site which page it is currently linking is the only version
 * that keeps working, and it fails loudly when the shape changes rather than quietly returning
 * an empty pool.
 *
 * Return an empty array to mean "I could not find them" — the runner treats that as a failed
 * run and records it, rather than as a store with no products.
 */
export type DiscoverRoutes = () => Promise<Route[]>;

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
  /**
   * A price RENDERED AS SEPARATE NODES, with the lei and the bani in different elements and no
   * currency symbol anywhere on the card.
   *
   * Selgros renders `34,99 lei/kg` as:
   *
   *     <p>per kg</p>
   *     <div class="… leading-8">
   *       <span class="text-2xl …"> 34 </span>
   *       <span class="text-xs …"> 99 </span>
   *     </div>
   *     <div>07/09/2026 - 13/09/2026</div>
   *
   * `textContent` of any ancestor is therefore `per kg 34 99 07/09/2026 - 13/09/2026`, which a
   * price parser can read as 34, as 99, as 3499, or — before `parsePrice` learned to strip
   * dates — as **7,09**. Every one of those is a fabricated price on a comparison site, and
   * none of them looks wrong in the database.
   *
   * A promo card is worse: it carries TWO prices, the old one first, struck through with an
   * absolutely-positioned `<span>` bar rather than a `<del>`. Taking the first group publishes
   * the pre-discount price as the current one.
   *
   * So the parts are read explicitly and joined, and the reader REFUSES anything that is not
   * exactly one integer group and one 2-digit decimal group. A refusal is recorded; a guess is
   * not available.
   */
  priceParts?: {
    /** the element holding ONE price's parts. Several may match; see `strikeMarker`. */
    group: string;
    /** the numeric parts inside a group, in reading order (lei then bani) */
    part: string;
    /** a group containing THIS is a struck "was" price and is read as the reference, not the price */
    strikeMarker?: string;
    /** the merchant's own unit label ("per kg", "per BUC.") — captured, never inferred */
    unitLabel?: string;
  };
  /**
   * Selectors for the merchant's own REFERENCE-PRICE statement — the EU-Omnibus 30-day
   * minimum, or a struck "was" price — read SEPARATELY from the price.
   *
   * WHY IT IS ITS OWN FIELD RATHER THAN A WIDER `price` SELECTOR. Penny prints
   * "preț minim ultimele 30 de zile: 6,99 LEI" in a sibling of the price node, next to a
   * validity range reading "de mi 09.09.2026 până ma 15.09.2026". A loose `[class*="price"]`
   * caught all three, the date parsed as a number, and **1092026 lei** was written onto real
   * products. The fix at the time was to narrow the price selector, which also threw the
   * 30-day figure away — and that is why the OMNIBUS_30D column held zero rows across the
   * whole database while the figure sat on the page.
   *
   * Text matched here can NEVER become a price: the runner takes only the reference fields
   * from it and discards `priceBani`. The dangerous block is readable again because the one
   * thing it must not supply is unreachable by construction, not by selector discipline.
   */
  reference?: string[];
  /**
   * Selectors for a LOYALTY-CARD price, where the merchant quotes one beside the shelf price.
   *
   * `price` must stay the price anyone pays. Penny prints both on every tile and the wrapper
   * selector swept up all of it, so `price` ended up holding the card price — and, worse, the
   * PER-UNIT figure printed under it. See `penny.ts`.
   */
  loyalty?: string[];
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
  /**
   * Optional: work out `routes` from the live site instead of trusting the config.
   * When present the runner calls it and uses the result; `routes` stays as documentation
   * of the shape and as the offline-fixture path.
   */
  discoverRoutes?: DiscoverRoutes;
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
