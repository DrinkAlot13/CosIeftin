// Delivery-platform storefronts, as CONFIG ROWS.
//
// One adapter serves every (platform, merchant, city) combination; adding a merchant is a row
// here and nothing else. Four near-identical scrapers is how this project ended up with four
// divergent write paths and the bugs that came with them.
//
// THE CITY SLUG IS `bucharest`, NOT `bucuresti`, and that one letter cost a whole recon pass.
// Glovo's own /ro/ro/glovo-delivery/categories/supermarket page still links
// `/ro/ro/bucuresti/stores/kaufland-buc`, which 302s into a soft 404 — the same staleness the
// sitemaps have. The live path, confirmed by following the site's own navigation with a delivery
// address set, is `/ro/ro/bucharest/stores/<slug>`. Trust the running site over its own links.

export type PlatformKey = "glovo";

export type StorefrontConfig = {
  /** Config row id, used for logs and the merchant slug suffix. */
  key: string;
  platform: PlatformKey;
  /** Our `Merchant.slug` — the row that receives the offers. */
  merchantSlug: string;
  /** Human name, for logs and the UI label. */
  merchantName: string;
  /** Platform's own city slug. */
  city: string;
  /** Platform's own store slug. */
  storeSlug: string;
  /** Section the products belong to. */
  section: string;
  /** Enabled storefronts are the ones a run touches. */
  enabled: boolean;
};

/** Where a storefront lives on the platform. */
export function storeUrl(c: StorefrontConfig): string {
  return `https://glovoapp.com/ro/ro/${c.city}/stores/${c.storeSlug}`;
}

/**
 * The storefronts.
 *
 * Only Kaufland is enabled: the brief says Kaufland Bucharest first, report, then decide. The
 * other five are listed because discovery already found them and writing them down is free —
 * but an adapter that quietly ingests six stores when it was asked for one is not a smaller
 * mistake than a broken one.
 */
export const STOREFRONTS: StorefrontConfig[] = [
  { key: "glovo-kaufland-buc", platform: "glovo", merchantSlug: "glovo-kaufland", merchantName: "Kaufland (Glovo)", city: "bucharest", storeSlug: "kaufland-buc", section: "grocery", enabled: true },

  // Discovered, deliberately NOT enabled. The owner decides whether to extend.
  { key: "glovo-penny-buc", platform: "glovo", merchantSlug: "glovo-penny", merchantName: "Penny (Glovo)", city: "bucharest", storeSlug: "penny-buc", section: "grocery", enabled: false },
  { key: "glovo-carrefour-buc", platform: "glovo", merchantSlug: "glovo-carrefour", merchantName: "Carrefour (Glovo)", city: "bucharest", storeSlug: "carrefour-buc", section: "grocery", enabled: false },
  { key: "glovo-mega-buc", platform: "glovo", merchantSlug: "glovo-mega-image", merchantName: "Mega Image (Glovo)", city: "bucharest", storeSlug: "mega-image-buc", section: "grocery", enabled: false },
  { key: "glovo-freshful-buc", platform: "glovo", merchantSlug: "glovo-freshful", merchantName: "Freshful (Glovo)", city: "bucharest", storeSlug: "freshful-buc", section: "grocery", enabled: false },
  { key: "glovo-carrefour-sm-buc", platform: "glovo", merchantSlug: "glovo-carrefour-sm", merchantName: "Carrefour Supermarket (Glovo)", city: "bucharest", storeSlug: "carrefour-supermarket-buc", section: "grocery", enabled: false },
];

export function enabledStorefronts(): StorefrontConfig[] {
  return STOREFRONTS.filter((s) => s.enabled);
}

export function storefrontByKey(key: string): StorefrontConfig | undefined {
  return STOREFRONTS.find((s) => s.key === key);
}

/**
 * The delivery address that unlocks a catalog, and where its session lives.
 *
 * ONE address, created ONCE, reused by every run. It is stored as a browser cookie
 * (`glovo_delivery_address`) captured into this file — see docs/data-sources.md for exactly what
 * that cookie contains and why NOTHING was written to Glovo's servers to obtain it.
 */
export const GLOVO_SESSION_PATH = "config/glovo-session.json";

/** Politeness. We are a guest doing something robots.txt does not explicitly describe. */
export const RATE = {
  /** Between category pages. */
  betweenCategoriesMs: 4000,
  /** Between scroll steps inside a category. */
  betweenScrollsMs: 1200,
  /** Hard ceiling on scroll steps, so a broken selector cannot loop forever. */
  maxScrollsPerCategory: 40,
};
