// Penny România — Vue/Nuxt storefront, product tiles are `[data-test="product-tile"]`.
// Penny has no online delivery: these are SHELF prices from the weekly offer pages.
import type { Adapter } from "./types";

const BASE = "https://www.penny.ro";

// Penny's offer categories rotate weekly (…-kw35 = calendar week). The current-week
// listing is the reliable entry point; category pages below it are stable slugs.
export const penny: Adapter = {
  slug: "penny",
  name: "Penny",
  websiteUrl: BASE,
  color: "#d40f14",
  storeType: "physical",
  priceChannel: "shelf",
  section: "grocery",
  addNew: true,
  mode: "dom",
  maxPages: 1,
  delayMs: 1500,
  routes: [{ url: `${BASE}/categorie/oferte-site-kw35`, cat: "oferte" }],
  dom: {
    card: '[data-test="product-tile"]',
    // the tile's accessible name lives in .show-sr-and-print
    name: [".show-sr-and-print", '[data-test="product-tile-link"]', ".ws-product-tile__title"],
    // IMPORTANT: NOT a loose [class*="price"] — that also matches the validity-range and
    // 30-day-low blocks, whose dates parsed as a price and wrote 1092026 lei onto real
    // products (caught by the sanity gate). Target the regular-price node only.
    price: [".ws-product-price-wrapper__container", '[data-test="product-price"]', ".ws-product-price"],
    image: ["img.ws-product-image", "img"],
    link: ['a[data-test="product-tile-link"]', "a[href]"],
  },
};
