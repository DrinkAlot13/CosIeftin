// Selgros România — cash&carry, server-rendered cards, and a price that is not a string.
//
// ── WHY THIS ADAPTER POOLED ZERO PRODUCTS, established by `npm run probe:selgros` rather than
// from the note in docs/data-sources.md, which was half wrong.
//
// The cards ARE there: 64 of them on the home page, `a.product-item[data-product-id]`, present
// within 15s. What is not there is a price a parser can read. Selgros prints no currency symbol
// anywhere on the card and splits the amount across two elements:
//
//     <p>per kg</p>
//     <div class="… leading-8">
//       <span class="text-2xl …"> 34 </span>      ← lei
//       <span class="text-xs …"> 99 </span>       ← bani
//     </div>
//     <div>07/09/2026 - 13/09/2026</div>          ← promo validity
//
// So `textContent` of the price block is `per kg 34 99 07/09/2026 - 13/09/2026`. `parsePrice`
// returns **null** for that, and for `34 99 07/09/2026 - 13/09/2026`, and for the whole card —
// which is the reason this merchant has zero offers rather than wrong ones. That refusal was
// doing real work and the fix must not weaken it: reading the wrong thing here yields **34**,
// **99**, **3499** or **7,09** (the date), every one of which is a plausible-looking fabricated
// price on a comparison site.
//
// ── A PROMO CARD CARRIES TWO PRICES, OLD FIRST.
//
//     ┌ - 30 %                          ┌ per kg
//     │ [42] [99]  ← struck             │ [29] [99]  ← what you pay
//
// and the strikethrough is an absolutely-positioned `<span>` drawn ACROSS the digits, not a
// `<del>` or an `<s>`. Every "was price" heuristic in this codebase looks for those tags, so
// nothing would have noticed; taking the first group publishes 42,99 for an item at 29,99.
// `strikeMarker` names that bar, which is what makes old and new separable at all.
//
// ── `per kg` IS PART OF THE CLAIM. These are per-kilogram prices for weighed goods — LEROY
// SOMON 1 2 KG at 34,99 is 34,99 PER KILO, not for the pack. Storing it as a pack price is
// exactly the defect just fixed at Penny, where a per-unit figure was published as the price of
// a 40-piece box. The label is captured verbatim rather than assumed.
import type { Adapter } from "./types";

const BASE = "https://www.selgros.ro";

export const selgros: Adapter = {
  slug: "selgros",
  name: "Selgros",
  websiteUrl: BASE,
  color: "#e2001a",
  storeType: "hybrid",
  priceChannel: "shelf",
  section: "grocery",
  addNew: true,
  maxPages: 1,
  delayMs: 1500,
  mode: "dom",
  // ONE ROUTE, because the other one is empty. `/exploreaza-sortimentul-selgros` renders 0
  // cards — measured, not assumed: the probe waits 15s for the same selector on both URLs and
  // gets 64 and 0. Keeping a route that yields nothing makes a healthy run look half-broken and
  // hides the day the working one stops working.
  routes: [{ url: `${BASE}/`, cat: "oferte" }],
  dom: {
    card: "a.product-item[data-product-id]",
    // The title is the LAST span in the text block; `.product-id` holds "Art. number: 803593".
    // `img[alt]` carries the same string and is the fallback.
    name: ["span.font-700", ".product-title", "h3"],
    // Deliberately empty: there is no single node holding a readable price. Leaving a selector
    // here that matches the wrapper is how `per kg 34 99 07/09/2026` became the price text.
    price: [],
    priceParts: {
      group: ".sf-product-price div.leading-8",
      part: "span",
      // The struck group is the one containing the bar element drawn over the digits.
      strikeMarker: "span.absolute",
      // `span.mr-auto`, not `span.text-sm`: the discount badge ("- 30 %") also carries
      // `text-sm`, and the looser selector reported it as the unit for 20 of 64 cards — a
      // percentage standing where "per kg" belongs. Measured with `probe:selgros-parse`.
      unitLabel: ".sf-product-price p, .sf-product-price span.mr-auto",
    },
    image: ["img"],
    link: [],
  },
};
