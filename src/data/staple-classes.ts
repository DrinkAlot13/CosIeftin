// General-brand equivalence classes — batch 1 of an ongoing, deliberately slow curation pass.
//
// Different problem from `private-label-classes.ts` (one retailer's OWN brand vs another's own
// brand): this is cross-BRAND equivalence for genuinely any-brand-interchangeable staples —
// Lavazza whole-bean coffee is "the same trade" as Tchibo whole-bean coffee for a shopper who
// just wants coffee beans, the way `lapte-integral-1l` already treats ZuZu and LaDorna milk.
//
// WHY THIS EXISTS. 33,527 grocery products carry no equivalence class (measured 2026-10-03,
// `npm run cluster:report`), and they are not evenly spread: they cluster into ~3,760 distinct
// (unit, head-noun) groups, 667 of which cover 80% of the total. So the work is reviewing a few
// hundred real categories, not 33,000 products — this file is the output of doing that reading,
// one evidenced batch at a time, never a generated guess.
//
// THE METHOD, so the next batch follows it too:
//   1. `npm run cluster:report` — read actual member names in a cluster, largest first.
//   2. Decide: one genuine class, several (split on flavour/form/fat%), or none (a head-noun
//      collision with no real substitute — see the `headNoun` VARIANT_MARKERS fix this same
//      session, which already removed the worst offender, "eco").
//   3. Write the class here with `pack()` (shared with private-label-classes.ts — one helper,
//      one window convention, not two).
//   4. `npm run propose:equivalence` (DRY RUN) and READ the proposed members before `--apply`.
//      The require/exclude lists below are informed by real catalog names, not assumed, but the
//      dry-run table is still the actual safety check, not this comment.
//
// WHAT WAS DELIBERATELY LEFT OUT OF THIS BATCH, same discipline as private-label-classes.ts:
//   - Flavoured chocolate, biscuits, chips, yoghurt-by-flavour, and the "bautura"/"suc" aisle —
//     each is real volume (300-1000+ products) but needs a much longer exclude list to keep
//     flavours and fillings apart (a plain milk-chocolate class sitting one word away from
//     "Ciocolata cu lapte si arahide" is exactly the false-match shape this project keeps
//     finding). Left for a dedicated pass with more per-cluster reading time, not skipped
//     because it is unimportant — it is the single biggest remaining pool.
//   - Laundry detergent beyond the existing 3 L class: wash-count varies independently of
//     volume (16 washes in 1.45 L next to 40 washes in 1.8 L), so per-litre price is not
//     obviously the right comparison and deserves its own judgement call, not a quick pack().

import { pack, type PrivateLabelClass } from "./private-label-classes";

export const STAPLE_CLASSES: PrivateLabelClass[] = [
  // ══ WATER — more sizes of the same two proven classes (apa-plata-05l, apa-carbogazoasa-05l,
  //    apa-plata-2l already exist). A "5+1 x 2 l" multipack totals ~12 l and falls well outside
  //    every window here, so it is excluded by SIZE alone — no extra exclude term needed.
  pack("apa-plata-1l", "Apă plată de izvor, 1 L", "l", 1,
    ["apa", "plata"],
    ["gura", "micelara", "termala", "distilata", "oxigenata", "tonica", "minerala",
     "carbogaz", "aromatizata", "vitaminizata", "parfum", "toaleta", "colonie", "bebe", "demachiant",
     "afine", "menta", "lamaie", "capsuni", "zmeura", "portocale", "piersici", "ghimbir", "castravete"]),
  pack("apa-plata-15l", "Apă plată de izvor, 1,5 L", "l", 1.5,
    ["apa", "plata"],
    ["gura", "micelara", "termala", "distilata", "oxigenata", "tonica", "minerala",
     "carbogaz", "aromatizata", "vitaminizata", "parfum", "toaleta", "colonie", "bebe", "demachiant",
     "afine", "menta", "lamaie", "capsuni", "zmeura", "portocale", "piersici", "ghimbir", "castravete"]),
  pack("apa-plata-5l", "Apă plată de izvor, 5 L", "l", 5,
    ["apa", "plata"],
    ["gura", "micelara", "termala", "distilata", "oxigenata", "tonica", "minerala",
     "carbogaz", "aromatizata", "vitaminizata", "parfum", "toaleta", "colonie", "bebe", "demachiant",
     "afine", "menta", "lamaie", "capsuni", "zmeura", "portocale", "piersici", "ghimbir", "castravete"]),
  pack("apa-carbogazoasa-1l", "Apă carbogazoasă de izvor, 1 L", "l", 1,
    ["apa", "carbogaz"],
    ["gura", "micelara", "termala", "tonica", "aromatizata", "vitaminizata", "parfum", "plata", "necarbogaz", "decarbogaz",
     "afine", "menta", "lamaie", "capsuni", "zmeura", "portocale", "piersici", "ghimbir", "castravete"]),
  pack("apa-carbogazoasa-15l", "Apă carbogazoasă de izvor, 1,5 L", "l", 1.5,
    ["apa", "carbogaz"],
    ["gura", "micelara", "termala", "tonica", "aromatizata", "vitaminizata", "parfum", "plata", "necarbogaz", "decarbogaz",
     "afine", "menta", "lamaie", "capsuni", "zmeura", "portocale", "piersici", "ghimbir", "castravete"]),
  pack("apa-carbogazoasa-2l", "Apă carbogazoasă de izvor, 2 L", "l", 2,
    ["apa", "carbogaz"],
    ["gura", "micelara", "termala", "tonica", "aromatizata", "vitaminizata", "parfum", "plata", "necarbogaz", "decarbogaz",
     "afine", "menta", "lamaie", "capsuni", "zmeura", "portocale", "piersici", "ghimbir", "castravete"]),

  // ══ COFFEE — three different FORMS (boabe/măcinată/solubilă), never merged with each other;
  //    `cafea-macinata-250g` and `cafea-macinata-decofeinizata-250g` already exist at 250 g.
  pack("cafea-boabe-1kg", "Cafea boabe, 1 kg", "kg", 1,
    ["cafea", "boabe"],
    ["decofeinizat", "decafeinizat"]),
  pack("cafea-boabe-500g", "Cafea boabe, 500 g", "kg", 0.5,
    ["cafea", "boabe"],
    ["decofeinizat", "decafeinizat"]),
  pack("cafea-macinata-500g", "Cafea măcinată, 500 g", "kg", 0.5,
    ["macinata"],
    ["decofeinizat", "decafeinizat", "capsule", "boabe", "instant", "filtru", "lapte pentru", "frisca"]),
  // "Cafea instant Nescafe Cappuccino Irish, 8 x 14 g" is a flavoured-sachet multipack at 112 g
  // — inside a 100 g ±10% window by coincidence of total weight, so it needs its own exclude
  // rather than relying on size the way the bigger "3 in 1" boxes already are (302 g, outside
  // the window on size alone).
  pack("cafea-solubila-100g", "Cafea solubilă, 100 g", "kg", 0.1,
    ["cafea", "solubila|instant"],
    ["decofeinizat", "decafeinizat", "3 in 1", "cappuccino", "plic", "capsule", "frisca"]),
  pack("cafea-solubila-200g", "Cafea solubilă, 200 g", "kg", 0.2,
    ["cafea", "solubila|instant"],
    ["decofeinizat", "decafeinizat", "3 in 1", "cappuccino", "plic", "capsule", "frisca"]),

  // ══ BEER — sibling of the existing `bere-blonda-500ml` at the other dominant single-bottle
  //    size. A "6 x 0.33 l" / "5+1 x 0.33 l" pack totals 1.98-2.31 l, well outside this window.
  pack("bere-blonda-033l", "Bere blondă, 0,33 L", "l", 0.33,
    ["blonda"],
    ["fara alcool", "bruna", "radler"]),

  // ══ PASTA — sibling of the existing `paste-500g`, at 200 g (fidea cuburi, taitei), with a
  // longer exclude list than the 500 g class needed: at 200 g the same "paste" head noun also
  // catches filled fresh pasta, gluten-free lines and boxed mac-and-cheese, none of which a
  // shopper treats as interchangeable with a bag of dry noodles.
  pack("paste-200g", "Paste făinoase, 200 g", "kg", 0.2,
    ["paste"],
    ["dinti", "tomate", "sos", "pizza", "instant", "noodles",
     "umplute", "branza", "cheese", "gluten", "cuscus", "proaspete", "trufe", "jalapeno", "carne", "ton", "pesto"]),
];
