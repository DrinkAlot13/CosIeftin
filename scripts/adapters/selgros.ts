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
import { parseSize } from "../../src/lib/ingest-core";
import type { StoreProduct } from "../../src/lib/scrape-util";
import type { Adapter } from "./types";

const BASE = "https://www.selgros.ro";

/** "per kg" / "per L" — a price for a kilogram of the thing, not for the thing. */
const PER_WEIGHT = /per\s*(kg|l)\b/i;
/** "per BUC." — a price for the thing itself. */
const PER_PIECE = /per\s*buc/i;

/**
 * ── A BARE "KG" IN THE NAME IS THE UNIT OF SALE, NOT A MISSING NUMBER.
 *
 * The first version of the rule below required `parseSize` to yield exactly 1 kg, and refused
 * everything else. It threw away six products that were never ambiguous:
 *
 *     PIERSICI KG GRECIA CALITATEA I        peaches, sold by the kilo, 5,99 per kg
 *     ZUCCHINI KG POLONIA CALITATEA I       courgettes, by the kilo, 6,49 per kg
 *     CARNATI CA LA MOLDOVA KG              sausages, by the kilo
 *
 * `parseSize` returns null for those — correctly, since there is no quantity in the name — and
 * "no parsed size" was read as "unknown pack", when what the name actually says is that the
 * unit of sale IS one kilogram. The per-kilo price is then the price, exactly.
 *
 * The discriminator is what PRECEDES the unit token. `LEROY SOMON 1 2 KG` has numbers before
 * it and stays refused: that is a fish weighing between one and two kilos, and its per-kilo
 * price is not what the fish costs.
 */
function soldByTheUnit(name: string, quoted: string): boolean {
  const toks = name.toUpperCase().split(/[\s,._/()]+/).filter(Boolean);
  const want = quoted === "kg" ? "KG" : "L";
  for (let i = 0; i < toks.length; i++) {
    if (toks[i] !== want) continue;
    const prev = i > 0 ? toks[i - 1] : "";
    // A number before the unit makes it a QUANTITY ("2 KG", "0,75 L"), not a unit of sale.
    if (/\d/.test(prev)) continue;
    return true;
  }
  return false;
}

/**
 * ── THE JUDGEMENT: A PER-KILO PRICE IS NOT A PACK PRICE, SO IT DOES NOT BECOME ONE.
 *
 * The card states its unit, and the two are different claims:
 *
 *     per BUC.   36 of 64      what the item costs                → an offer
 *     per kg     24 of 64      what a kilogram of it costs        → only if the pack IS 1 kg
 *     (none)      4 of 64      unstated                           → not written
 *
 * `LEROY SOMON 1 2 KG` at 34,99 per kg is a fish weighing somewhere between one and two
 * kilograms. There is no pack price on that card and none can be derived, because the card does
 * not say what the pack weighs. Publishing 34,99 as its price would repeat, on a new merchant,
 * the exact defect just fixed at Penny — where a per-unit figure was published as the price of a
 * 40-piece box, at 0,45 lei against a real 17,99.
 *
 * `CARNATI CA LA MOLDOVA KG` is the case that DOES resolve: the name says the unit sold is one
 * kilogram, so the per-kilo price and the pack price are the same number and there is nothing to
 * get wrong. That is decided by `parseSize` — the project's one size parser — rather than by
 * looking for "KG" in the name, which would also match "1 2 KG" and "300_600G".
 *
 * A declined row is REFUSED, not dropped: price 0 carries it into `matchPoolToCatalog`, which
 * records it with its `rawPriceText` and now with the reason below, so "we cannot price this" is
 * visible instead of looking like a product Selgros does not sell.
 */
export function selgrosRefine(p: StoreProduct): StoreProduct {
  const unit = p.quotedUnit ?? "";
  if (!unit) {
    return { ...p, price: 0, refusalReason: "Selgros stated no unit for this price (neither 'per BUC.' nor 'per kg')" };
  }
  if (PER_PIECE.test(unit)) return p;

  const m = PER_WEIGHT.exec(unit);
  if (!m) return { ...p, price: 0, refusalReason: `Selgros quoted this price ${JSON.stringify(unit)}, which is neither a piece nor a weight` };

  const quoted = m[1].toLowerCase();
  const size = parseSize(p.name);
  const parsedOneUnit =
    size != null &&
    Math.abs(size.unitSize - 1) < 0.001 &&
    ((quoted === "kg" && size.unit === "kg") || (quoted === "l" && size.unit === "l"));

  if (parsedOneUnit || soldByTheUnit(p.name, quoted)) return p;

  return {
    ...p,
    price: 0,
    // The per-unit figure is a real and correct fact about this product. It is simply not the
    // price of the pack, and we have no pack size to turn it into one.
    quotedUnit: unit,
    refusalReason:
      `Selgros quotes ${p.price.toFixed(2)} per ${quoted} and does not state the pack weight, ` +
      `so no pack price can be derived (parsed size: ${size ? `${size.unitSize} ${size.unit}` : "none"})`,
  };
}

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
  refine: selgrosRefine,
};
