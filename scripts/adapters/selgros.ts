// Selgros România — server-rendered listing, cards are `a.product-item[data-product-id]`.
// Selgros is cash&carry (hybrid: warehouse + online ordering), prices are shelf prices.
import type { Adapter } from "./types";

const BASE = "https://www.selgros.ro";

export const selgros: Adapter = {
  slug: "selgros",
  name: "Selgros",
  websiteUrl: BASE,
  color: "#e2001a",
  storeType: "hybrid",
  priceSource: "shelf",
  section: "grocery",
  addNew: true,
  maxPages: 1,
  delayMs: 1500,
  mode: "dom",
  // Selgros's category listing is rendered client-side and its category slugs are not in the
  // HTML; the reliably-populated surfaces are the home page and the assortment landing, both
  // of which carry `a.product-item[data-product-id]` cards once JS runs.
  routes: [
    { url: `${BASE}/`, cat: "oferte" },
    { url: `${BASE}/exploreaza-sortimentul-selgros`, cat: "oferte" },
  ],
  dom: {
    card: "a.product-item[data-product-id]",
    name: [".product-title", "h3", '[class*="title"]', ".product-name"],
    // avoid a loose [class*=price]: it also catches unit-price and reference-price nodes
    price: [".price-value", ".product-price", '[class*="price"]'],
    image: ["img"],
    link: [],
  },
};
