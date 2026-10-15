// WineMag — online wine & spirits shop, MerchantPro storefront (server-rendered, no SPA,
// no anti-bot wall). Added for the `alcohol` section, which before this had three sources —
// Carrefour, FineStore, Le Manoir — and the latter two are small (284 and 92 live offers), so
// most comparisons there were really "Carrefour vs nothing".
//
// `robots.txt` publishes `Crawl-delay: 5`, a real stated rate limit from a small business, not
// a suggestion — `delayMs` below matches it exactly, same spirit as respecting Selgros's ToS.
//
// WHY CATEGORY LISTING PAGES, NOT PER-PRODUCT PAGES. Each product page DOES carry a clean
// schema.org Product JSON-LD (name/price/brand/availability), which is normally the first
// choice here — but it is one request per product, and the catalog is ~9,576 products behind a
// 5-second crawl delay: that is ~13 hours for a single run. The category grid instead renders
// 24 priced tiles (name, current price, struck "was" price) per page load, so the same catalog
// costs roughly one request per 24 products instead of one per product.
//
// WHY THESE 22 CATEGORIES AND NOT THE FULL NAV. WineMag's nav also links every BRAND page
// (`/jidvei`, `/purcari`, `/cricova`, …) and every bar-accessory category (`/pahare`,
// `/decantoare`, `/tirbusoane`, …). A brand page is the same products already reachable from
// their colour/spirit category — scraping it too would not find anything new, only refetch
// what `vinuri-albe` etc. already found (harmless, since the runner dedupes by url+name, but it
// would multiply the request count for zero benefit under a 5s crawl delay). Accessories are
// not alcohol and do not belong in this section at all. Measured via each category's own
// schema.org ItemList `numberOfItems`: these 22 sum to ~7,550 of the sitemap's ~9,576 products;
// the remainder is almost entirely the accessory categories this list deliberately excludes.
import type { Adapter, Route } from "./types";

const BASE = "https://www.winemag.ro";

const CATEGORIES: { slug: string; cat: string }[] = [
  // Wine, by colour — each is itself a parent of the sec/demisec/demidulce/dulce sub-filters,
  // so scraping the parent already covers every sweetness level.
  { slug: "vinuri-albe", cat: "vin-alb" },
  { slug: "vinuri-rosii", cat: "vin-rosu" },
  { slug: "vinuri-roze", cat: "vin-roze" },
  { slug: "vinuri-spumante", cat: "vin-spumant" },
  // Checked live on 2026-10-14 against the site's own llms.txt, which lists several categories
  // never in this file: vinuri-bag-in-box (347 items — substantial, a real wine format, not a
  // subset of the colour categories above) and vinuri-ecologice (34 — organic wines, may
  // partially overlap the colour categories but the runner dedupes by url+name, so the only
  // cost of any overlap is a few extra requests). cidru (cider, 1 item) is trivial but free.
  // Checked live on 2026-10-15 via each page's own schema.org ItemList numberOfItems (rate
  // limit had cooled off): vinuri-import 283, vinuri-magnum 10, miniaturi 53 — all genuine
  // wine-format variants (imported bottling, magnum size, mini bottles), not subsets of the
  // colour categories, so added below. spirits (2,189) is excluded: it is WineMag's own
  // cross-category "all spirits" aggregator, and every spirit category below (coniac, rom,
  // gin, vodka, whisky, tuica, …) already covers that ground individually — adding it would
  // only refetch what those already find (harmless per the runner's dedupe, but zero benefit
  // under a 5s crawl delay). cafea/ceai/alimente/bauturi-fara-alcool (16/29/58/435) are real
  // but non-alcohol grocery items sold by a wine shop; WineMag's merchant record here is
  // alcohol-section-only, and section-splitting it (Metro's pattern) for under 550 items
  // combined is not worth the added complexity right now.
  { slug: "vinuri-bag-in-box", cat: "vin" },
  { slug: "vinuri-ecologice", cat: "vin" },
  { slug: "vinuri-import", cat: "vin" },
  { slug: "vinuri-magnum", cat: "vin" },
  { slug: "miniaturi", cat: "vin" },
  { slug: "cidru", cat: "cidru" },
  // Spirits — no shared parent category exists for these, so each is its own route.
  { slug: "coniac-2", cat: "coniac" },
  { slug: "rom", cat: "rom" },
  { slug: "gin", cat: "gin" },
  { slug: "vodka", cat: "vodka" },
  { slug: "whisky", cat: "whisky" },
  { slug: "tuica", cat: "tuica" },
  { slug: "palinca", cat: "palinca" },
  { slug: "rachiu", cat: "rachiu" },
  { slug: "lichior", cat: "lichior" },
  { slug: "vermut-aperitiv", cat: "vermut" },
  { slug: "bitter", cat: "bitter" },
  { slug: "grappa", cat: "grappa" },
  { slug: "mezcal", cat: "mezcal" },
  { slug: "tequila", cat: "tequila" },
  { slug: "armagnac-2", cat: "armagnac" },
  { slug: "bere", cat: "bere" },
  { slug: "lambrusco", cat: "lambrusco" },
  { slug: "ready-to-drink", cat: "ready-to-drink" },
];

const routes: Route[] = CATEGORIES.map(({ slug, cat }) => ({ url: `${BASE}/${slug}/p{page}`, cat }));

export const winemag: Adapter = {
  slug: "winemag",
  name: "WineMag",
  websiteUrl: BASE,
  color: "#6b1023",
  storeType: "online",
  priceChannel: "delivery",
  section: "alcohol",
  addNew: true,
  mode: "dom",
  // A page past the real last one 302s back to the category root (verified: p63 of a
  // 62-page category → Location: /vinuri-albe), which is already fully seen, so pageAdded
  // becomes 0 and the per-route loop breaks on its own. Set above the largest category
  // (vinuri-rosii, 2205 items / 24 per page ≈ 92 pages) so no real page is missed.
  maxPages: 95,
  // robots.txt: "Crawl-delay: 5" — a stated limit, not a default to tune for speed.
  delayMs: 5000,
  routes,
  dom: {
    card: ".product.product--grid",
    name: [".product__name"],
    price: [".product__info--price-gross"],
    reference: [".product__info--old-price-gross"],
    image: [".grid-image__image"],
    link: [".product__name"],
  },
};
