// Private-label staples: thirty equivalence classes so a shop's own product is comparable with
// another shop's own product.
//
// ── THE PROBLEM, MEASURED (npm run audit:private-label).
//
// 3,859 live grocery products carry a retailer's own brand — 13.2% of the catalog — and 3,447
// of them are BOTH single-shop and unclassed. They can never match: Auchan's sunflower oil and
// Carrefour Classic's sunflower oil are genuinely different products with different names and
// different brands, and the matcher is right to keep them apart. Only an equivalence class can
// say they are the same trade.
//
// ── THIS FILE CREATES CLAIMS. Everything else in this project finds or fixes bugs; a wrong
// class here shows a shopper a false comparison. So it is built to fail loudly:
//
//   * every class states an explicit size window, min and max, never a tolerance percentage
//   * every class states require and exclude tokens, checked from outside by
//     `audit:private-label-classes`, which imports only PrismaClient
//   * a class resolving to fewer than 2 merchants is reported as not doing its job
//   * where a distinction is arguable, the products are KEPT APART. A missing comparison costs
//     nothing; a false one costs trust.
//
// ── WHAT IS DELIBERATELY ABSENT, and the omissions matter more than the entries.
//
// MILK. The brief's own headline example — "a shop's own 1 L milk comparable with another
// shop's own 1 L milk" — IS NOT HERE, and could not be written honestly. Carrefour names its
// treatment ("Lapte Uht Carrefour Clasic 3.5% 1L"); Mega Image and Freshful do not. Mega carries
// "Lapte de consum 3.5% grasime 1L" at 5,49 and "Lapte 3.5% grasime 1L" at 8,99 — same shop,
// same fat, same litre, and nothing in either name says which is UHT and which is fresh. The
// brief forbids merging UHT with fresh, and the catalog cannot tell them apart, so the class is
// not written. Requiring "uht" in the name yields a class with one merchant in it, which is not
// a comparison. This needs a treatment or shelf-life field from the merchant feed, not a
// cleverer rule.
//
// SUGAR SACHETS. `Zahar alb Auchan, 200 buc x 5 g` and `Zahar cristal 200x5g` are stored as
// 1 kg, exactly like a 1 kg bag, and they are not the same purchase. Excluded by name.
//
// EGGS, TOILET PAPER, PLAIN GROUND COFFEE, PLAIN 000 FLOUR, SUNFLOWER OIL. Classes for these
// already exist and hold live members; duplicating them would fight for the same products,
// because `Product.equivalenceClassId` is a single FK.

import type { ClassRules } from "../lib/substitution/class-rules";

export type PrivateLabelClass = {
  slug: string;
  label: string;
  /** The unit the class is PRICED IN. Every member's unit price is lei per this unit. */
  unit: "kg" | "l" | "buc";
  unitSize: number;
  attributes: Record<string, unknown> & ClassRules;
};

/** BIO/ECO is never merged with conventional: the price gap is the point, not a footnote. */
const BIO = ["bio", "eco", "organic", "ecologic"];

/**
 * Build a class with an explicit window expressed as a fraction of the nominal size.
 *
 * The window is still WRITTEN OUT into min/max — this only saves typing the arithmetic. A tight
 * default of ±10% keeps a 400 g tin out of a 500 g class; where a real product line straddles
 * more than that (680 g and 690 g brines), the class says so itself.
 */
export function pack(
  slug: string,
  label: string,
  unit: "kg" | "l" | "buc",
  unitSize: number,
  require: string[],
  exclude: string[],
  window = 0.1,
): PrivateLabelClass {
  return {
    slug, label, unit, unitSize,
    attributes: {
      require,
      exclude,
      strictRules: true,
      minUnitSize: Number((unitSize * (1 - window)).toFixed(4)),
      maxUnitSize: Number((unitSize * (1 + window)).toFixed(4)),
    },
  };
}

export const PRIVATE_LABEL_CLASSES: PrivateLabelClass[] = [
  // ══ WATER ═══════════════════════════════════════════════════════════════════════════════
  // `apa` at 0,5 l is half MOUTHWASH — "Apa de gura 6in1 Total Care Auchan, 500 ml" at 9,99
  // sitting beside spring water at 1,39. `gura` is the whole difference and the head noun is
  // identical, which is what a class is for and also exactly how one goes wrong.
  pack("apa-plata-05l", "Apă plată de izvor, 0,5 L", "l", 0.5,
    ["apa", "plata"],
    ["gura", "micelara", "termala", "distilata", "oxigenata", "tonica", "minerala",
     "carbogaz", "aromatizata", "vitaminizata", "parfum", "toaleta", "colonie", "bebe", "demachiant",
     "afine", "menta", "lamaie", "capsuni", "zmeura", "portocale", "piersici", "ghimbir", "castravete"]),

  pack("apa-carbogazoasa-05l", "Apă carbogazoasă de izvor, 0,5 L", "l", 0.5,
    ["apa", "carbogaz"],
    // "carbogaz" is a SUBSTRING match, so "necarbogazoasa" and "decarbogazificata" satisfy it —
    // a still water let into the sparkling class by the token that defines the class. Exclusions
    // run before requirements, so naming the negations here is what actually keeps them out.
    ["gura", "micelara", "termala", "tonica", "aromatizata", "vitaminizata", "parfum", "plata", "necarbogaz", "decarbogaz",
     "afine", "menta", "lamaie", "capsuni", "zmeura", "portocale", "piersici", "ghimbir", "castravete"]),

  // ══ OIL ═════════════════════════════════════════════════════════════════════════════════
  // Extra-virgin olive oil only. `Ulei Carrefour Classic din Turte De Masline` is pomace oil at
  // half the price and says "masline" too — a near neighbour, named out rather than averaged in.
  pack("ulei-masline-extravirgin-1l", "Ulei de măsline extravirgin, 1 L", "l", 1,
    ["ulei", "masline", "extravirgin|extra virgin"],
    [...BIO, "turte", "pomace", "lampante", "rafinat", "spray", "aroma", "corp", "masaj", "par"]),

  pack("ulei-masline-extravirgin-500ml", "Ulei de măsline extravirgin, 500 ml", "l", 0.5,
    ["ulei", "masline", "extravirgin|extra virgin"],
    [...BIO, "turte", "pomace", "lampante", "rafinat", "spray", "aroma", "corp", "masaj", "par"]),

  // ══ SUGAR, FLOUR, SEMOLINA ══════════════════════════════════════════════════════════════
  // Brown sugar is not powdered, cubed, or raw ("brut"), and each of those is in the catalog at
  // 500 g under a name starting "Zahar brun".
  pack("zahar-brun-500g", "Zahăr brun, 500 g", "kg", 0.5,
    ["zahar", "brun"],
    [...BIO, "cubic", "cuburi", "pudra", "brut", "vanilat", "invertit", "candel", "buc x", "x5g",
     "plic", "baghete", "stick", "melasa", "nerafinat", "dark", "crystals", "muscovado", "demerara"]),

  // FĂINĂ 000 ≠ 650, and the existing `faina-alba-1kg` class merged them: its rule is
  // require ["alba|000"], which "Faina alba 650 Auchan, 1 kg" satisfies on the word "alba".
  // Different flour, different bake, different price. 650 gets its own class and the old one
  // gets "650" in its exclusions — see scripts/seed-equivalence.ts.
  pack("faina-alba-650-1kg", "Făină albă tip 650, 1 kg", "kg", 1,
    ["faina", "650"],
    [...BIO, "000", "integrala", "neagra", "porumb", "secara", "migdale", "cocos", "orez",
     "mix", "prajituri", "cozonac", "pizza", "paine", "manitoba", "graham"]),

  // ══ CONDIMENTS ══════════════════════════════════════════════════════════════════════════
  // Hot and mild mustard are the same price at both shops that carry both, so price is not the
  // discriminator — but they are not interchangeable on a shopping list, so they are two classes.
  pack("mustar-clasic-300g", "Muștar clasic, 300 g", "kg", 0.3,
    ["mustar", "clasic"],
    [...BIO, "iute", "picant", "boabe", "dijon", "miere", "hrean", "sos"]),

  pack("mustar-iute-300g", "Muștar iute, 300 g", "kg", 0.3,
    ["mustar", "iute"],
    [...BIO, "clasic", "boabe", "dijon", "miere", "hrean", "sos"]),

  pack("otet-alcool-1l", "Oțet din alcool, 1 L", "l", 1,
    ["otet", "alcool|9 grade|fermentatie"],
    [...BIO, "mere", "balsamic", "vin", "rodie", "cidru", "orez", "sherry", "aroma"]),

  // ══ TINNED VEGETABLES ═══════════════════════════════════════════════════════════════════
  // Sliced and whole mushrooms are separate: they are not the same job in a kitchen, and both
  // are carried at 280 g by the same shops.
  pack("ciuperci-taiate-conserva-280g", "Ciuperci tăiate la conservă, 280 g", "kg", 0.28,
    ["ciuperci", "taiate|felii"],
    [...BIO, "intregi", "congelat", "proaspete", "pleurotus", "shiitake", "crema", "supa", "sos", "pizza"]),

  pack("ciuperci-intregi-conserva-280g", "Ciuperci întregi la conservă, 280 g", "kg", 0.28,
    ["ciuperci", "intregi"],
    [...BIO, "taiate", "felii", "congelat", "proaspete", "pleurotus", "shiitake", "crema", "supa",
     "otet", "murate", "marar"]),

  // Sweetcorn at 340 g is carried by three shops at 4,99 each — the cleanest class in the set.
  pack("porumb-dulce-boabe-340g", "Porumb dulce boabe, 340 g", "kg", 0.34,
    ["porumb", "dulce|zaharat"],
    [...BIO, "floricele", "popcorn", "prajit", "baby", "faina", "malai", "pufuleti", "snack", "aroma"]),

  pack("porumb-dulce-boabe-150g", "Porumb dulce boabe, 150 g", "kg", 0.15,
    ["porumb", "dulce|zaharat"],
    [...BIO, "floricele", "popcorn", "prajit", "baby", "faina", "malai", "pufuleti", "snack", "aroma"]),

  // Peas: "verde" and "boabe" together keep out the pea-and-carrot mixes and the ready meals
  // ("Mazare cu carne de vita"), which are the same head noun and a different dinner.
  pack("mazare-verde-boabe-400g", "Mazăre verde boabe, 400 g", "kg", 0.4,
    ["mazare", "verde|semifina|semi fina"],
    [...BIO, "morcovi", "carne", "pui", "vita", "congelat", "uscata", "supa", "crema", "pastai", "snack"]),

  // ══ TINNED / DRY BEANS ══════════════════════════════════════════════════════════════════
  // The existing `fasole-alba-400g` class already excludes "rosie", so this does not fight it.
  pack("fasole-rosie-boabe-400g", "Fasole roșie boabe, 400 g", "kg", 0.4,
    ["fasole", "rosie|kidney"],
    [...BIO, "alba", "verde", "neagra", "uscata", "sos", "zacusca", "batuta", "iahnie",
     "ciolan", "costita", "carnati", "afumat", "supa"]),

  pack("fasole-alba-uscata-1kg", "Fasole albă uscată, 1 kg", "kg", 1,
    ["fasole", "alba"],
    [...BIO, "rosie", "verde", "neagra", "conserva", "sos", "zacusca", "batuta", "iahnie",
     "ciolan", "costita", "carnati", "afumat", "supa", "pastai"]),

  // ══ ZACUSCĂ ═════════════════════════════════════════════════════════════════════════════
  // Aubergine and mushroom zacuscă are different products at different prices; ghebe and fish
  // zacuscă are a third and fourth thing again, at 20 lei, and are named out of both.
  pack("zacusca-vinete-300g", "Zacuscă cu vinete, 300 g", "kg", 0.3,
    ["zacusca", "vinete"],
    [...BIO, "ciuperci", "ghebe", "peste", "fasole", "picant"]),

  pack("zacusca-ciuperci-300g", "Zacuscă cu ciuperci, 300 g", "kg", 0.3,
    ["zacusca", "ciuperci"],
    [...BIO, "vinete", "ghebe", "peste", "fasole", "picant"]),

  // ══ NUTS AND SEEDS ══════════════════════════════════════════════════════════════════════
  // Salted and unsalted are separate classes, because a shopper buying unsalted almonds is not
  // served by salted ones — and both are carried at 150 g by the same two shops.
  pack("migdale-sarate-150g", "Migdale coapte și sărate, 150 g", "kg", 0.15,
    ["migdale", "sarat"],
    [...BIO, "fara sare", "crude", "ciocolata", "lapte", "faina", "unt", "praline", "caramel"]),

  pack("migdale-fara-sare-150g", "Migdale coapte fără sare, 150 g", "kg", 0.15,
    ["migdale", "fara sare"],
    [...BIO, "crude", "ciocolata", "lapte", "faina", "unt", "praline", "caramel"]),

  // In-shell and shelled peanuts are priced per kilo of very different things — you pay for the
  // shell in one and not the other.
  pack("arahide-coaja-500g", "Arahide în coajă, coapte, 500 g", "kg", 0.5,
    ["arahide", "coaja"],
    [...BIO, "crude", "decojite", "unt", "ciocolata", "caramel", "susan", "wasabi"]),

  pack("arahide-decojite-500g", "Arahide decojite, prăjite, 500 g", "kg", 0.5,
    ["arahide", "prajit|decojit"],
    [...BIO, "coaja", "crude", "unt", "ciocolata", "caramel", "susan", "wasabi"]),

  // WHITE vs BLACK sunflower seeds is a 2x price difference in this catalog — a variety that
  // drives price, which the brief names explicitly as a thing not to merge.
  pack("seminte-albe-sarate-200g", "Semințe albe de floarea-soarelui, sărate, 200 g", "kg", 0.2,
    ["seminte", "albe"],
    [...BIO, "negre", "pestrite", "fara sare", "dovleac", "chia", "mac", "susan", "pin", "quinoa"]),

  pack("seminte-albe-sarate-100g", "Semințe albe de floarea-soarelui, sărate, 100 g", "kg", 0.1,
    ["seminte", "albe"],
    [...BIO, "negre", "pestrite", "fara sare", "dovleac", "chia", "mac", "susan", "pin", "quinoa"]),

  pack("stafide-brune-200g", "Stafide brune, 200 g", "kg", 0.2,
    ["stafide", "brune"],
    [...BIO, "aurii", "sultan", "ciocolata", "rom", "musli"]),

  // ══ CEREALS ═════════════════════════════════════════════════════════════════════════════
  // `integral` is a form, not a grade, so it is excluded rather than absorbed — same reason
  // făină 000 and 650 are two classes.
  pack("fulgi-ovaz-500g", "Fulgi de ovăz, 500 g", "kg", 0.5,
    ["fulgi", "ovaz"],
    [...BIO, "porumb", "integral", "instant", "musli", "granola", "ciocolata", "crocanti", "orez", "grau",
     "macinat", "faina", "tarate"]),

  // ══ AMBIENT GROCERY ═════════════════════════════════════════════════════════════════════
  pack("cafea-macinata-decofeinizata-250g", "Cafea măcinată decofeinizată, 250 g", "kg", 0.25,
    ["cafea", "macinata", "decofeinizat|decafeinizat"],
    [...BIO, "capsule", "boabe", "instant", "filtru", "lapte pentru", "frisca"]),

  pack("rahat-fructe-500g", "Rahat cu aromă de fructe, 500 g", "kg", 0.5,
    ["rahat", "fructe"],
    [...BIO, "trandafir", "ciocolata", "cocos", "asortat", "vanilie", "menta"]),

  pack("croissant-cacao-85g", "Croissant cu cremă de cacao, 85 g", "kg", 0.085,
    ["croissant", "cacao"],
    [...BIO, "vanilie", "visine", "capsune", "capsuni", "spumant", "caise", "miere", "unt", "simplu",
     "alune", "cocos", "padure", "dubla", "fistic", "lamaie"]),

  pack("sos-salsa-branza-300g", "Sos salsa cu brânză, 300 g", "kg", 0.3,
    ["sos", "salsa", "branza"],
    [...BIO, "guacamole", "picant", "condimentat", "iute", "taco", "chili"]),

  // ══ BATCH 27 — FOUND BY `propose:class-opportunities`, NOT BY CATEGORY BROWSING ═══════════
  //
  // This batch came from a different process than every one above: `npm run
  // propose:class-opportunities` groups the whole live catalog by head noun + size bucket and
  // ranks by (merchants × products), surfacing 2,022 candidate groups. Of those, 60 survived
  // its own mechanical filters (unit-price spread < 2x, not a brand family, not a generic
  // category word). Reading all 60 found that MOST were still not real classes — a single
  // brand's flavour assortment (Kit Kat varieties, Ricola drop flavours, Leonsteiner radler
  // flavours, pest-specific insecticides) scores exactly like a real class on these mechanical
  // filters, because a flavour range often prices within 2x of itself. Per CLAUDE.md's
  // "enumerating every flavour is a game you lose", those were left alone.
  //
  // The 21 below are what was left after reading: either a genuine cross-BRAND match on one
  // stated variant (mascarpone, linguine — plain, no flavour claim at all), or a same-BRAND,
  // same-FLAVOUR product whose name was spelled differently enough across merchants that the
  // ordinary matcher didn't merge it (the "parfum" and "untul" pairs below are almost certainly
  // the identical product with the brand name dropped by one scraper — a near-miss on identity
  // matching, not really a cross-brand equivalence, but a class is the safe way to reunite it).

  pack("chefir-3-3-900g", "Chefir 3,3% grăsime, 900 g", "kg", 0.9,
    ["chefir", "3 3"],
    [...BIO, "usor", "light"]),

  pack("mascarpone-500g", "Mascarpone, 500 g", "kg", 0.5,
    ["mascarpone"],
    [...BIO]),

  // Mangalița is a named pork breed/cure, not a generic "ham" — kept to its own class rather
  // than folded into "jambon" generally, same reasoning as the Serrano/Taranesc members this
  // batch declined to merge.
  pack("jambon-mangalita-100g", "Jambon Mangalița, 100 g", "kg", 0.1,
    ["jambon", "mangalita"],
    [...BIO]),

  pack("vinete-1buc", "Vinete, bucată", "buc", 1,
    ["vinete"],
    [...BIO, "graffiti"]),

  pack("grisine-cu-sare-250g", "Grisine cu sare, 250 g", "kg", 0.25,
    ["grisine", "sare"],
    [...BIO]),

  // "Izvorul Alb" (Dorna) still water, spelled two different ways across merchants — one
  // scraper kept the "Dorna" brand and the full "apă minerală necarbogazoasă" description, the
  // other shortened it to "Izvorul alb Apă plată". "Izvorul Minunilor" is a DIFFERENT, unrelated
  // product (carbonated) and lacks "alb", so it is excluded by the require list alone.
  pack("izvorul-alb-plata-500ml", "Izvorul Alb apă plată, 500 ml", "l", 0.5,
    ["izvorul", "alb"],
    [...BIO]),

  pack("coacaze-rosii-125g", "Coacăze roșii, 125 g", "kg", 0.125,
    ["coacaze", "rosii"],
    [...BIO]),

  pack("linguine-500g", "Linguine, 500 g", "kg", 0.5,
    ["linguine"],
    [...BIO]),

  // The two real recipes found inside the generic "blat" bucket: Boromir and Firesco each sell
  // both a plain base and a cocoa one, and the plain/cocoa split is what actually distinguishes
  // them — not the brand.
  pack("blat-tort-simplu-400g", "Blat de tort simplu, 400 g", "kg", 0.4,
    ["blat", "simplu"],
    [...BIO, "cacao"]),

  pack("blat-tort-cacao-400g", "Blat de tort cu cacao, 400 g", "kg", 0.4,
    ["blat", "cacao"],
    [...BIO, "simplu"]),

  // "Plasă" (net bag) excluded deliberately: Penny's "Lamâi Plasă" at 4,79 lei is very likely
  // priced for the bag, not the single lemon the other three rows price — the name does not say
  // how many are inside, and folding it in would compare one lemon's price with a bag's.
  pack("lamai-1buc", "Lămâie, bucată", "buc", 1,
    ["lamai"],
    [...BIO, "plasa"]),

  pack("somon-sashimi-300g", "Somon pentru sashimi, 300 g", "kg", 0.3,
    ["somon", "sashimi"],
    [...BIO]),

  pack("couscous-500g", "Couscous, 500 g", "kg", 0.5,
    ["couscous"],
    [...BIO, "semi complet", "integral"]),

  pack("inalbitor-clasic-1l", "Înălbitor clasic, 1 l", "l", 1,
    ["inalbitor", "clasic|regular"],
    [...BIO, "gel", "lavanda", "parfum"]),

  pack("soia-felii-100g", "Soia felii, 100 g", "kg", 0.1,
    ["soia", "felii"],
    [...BIO]),

  // Same brand (Herbarium Drops), same scent, spelled with and without the brand name across
  // two merchants — not a cross-brand claim, a reunification of one near-miss.
  pack("parfum-rufe-pisica-neagra-200ml", "Parfum de rufe Pisica Neagră, 200 ml", "l", 0.2,
    ["parfum", "rufe", "pisica neagra"],
    [...BIO]),

  pack("parfum-rufe-portocal-narcisa-200ml", "Parfum de rufe Floare de Portocal & Narcisă, 200 ml", "l", 0.2,
    ["parfum", "rufe", "portocal", "narcis"],
    [...BIO]),

  pack("baclava-visine-250g", "Baclava cu vișine, 250 g", "kg", 0.25,
    ["baclava", "visine"],
    [...BIO, "ciocolata"]),

  pack("baclava-nuca-250g", "Baclava cu nucă, 250 g", "kg", 0.25,
    ["baclava", "nuca"],
    [...BIO, "ciocolata", "sarailie"]),

  // Laptaria cu caimac's "Untul cel ___" line, brand dropped by one scraper on some rows —
  // same reunification pattern as the "parfum" pair above.
  pack("untul-cel-laptos-150g", "Untul cel laptos, 80% grăsime, 150 g", "kg", 0.15,
    ["untul", "laptos"],
    [...BIO, "sarat", "afumat", "gingas"]),

  pack("untul-cel-sarat-afumat-150g", "Untul cel sărat-afumat, 80% grăsime, 150 g", "kg", 0.15,
    ["untul", "sarat", "afumat"],
    [...BIO, "laptos", "gingas"]),
];
