// Fresh-produce equivalence classes: the loose-produce shelf, which is the most visible hole
// in the basket and the one a shopper notices first.
//
// WHY THESE WERE MISSING, and it is not what it looked like. Bananas, tomatoes and onions read
// as single-merchant, and the obvious reading is "only one shop sells them". Eight merchants
// stock produce — Sezamo 986 products, Metro 423, Auchan 344 — and struguri, morcovi and
// cartofi each appear at SEVEN. The items were never grouped, for two reasons:
//
//   1. Every shop names them differently: "Banane, +/- 1 kg" (Auchan), "Banane (bucata) cca
//      200 g" (Sezamo), "Banane Soi Cavendish" (Metro).
//   2. The class engine gated on pack size, and those three are 1 kg, 0.2 kg and 1 buc. Same
//      bananas, three packs, rejected. Hence `anySize` — see class-rules.
//
// WHAT IS DELIBERATELY KEPT APART. Merging these to raise a number would be the `crema` mistake
// in a new place, so each is a discriminator and not a footnote:
//
//   variety   Golden, Gala, Idared and Granny Smith are different apples at different prices.
//   origin    "românești" is a real premium a shopper is choosing, not a description.
//   BIO/ECO   priced far above conventional; 84 products lead with "ECO".
//   form      a 5 kg sack, a 500 g plasă and loose by the kilo are not one product.
//
// Where a distinction exists in the catalog it gets its own class; where it does not, the
// conventional class EXCLUDES the variant rather than swallowing it, so an unmatched product
// stays honestly unassigned instead of joining something it is not.
//
// Sizes are nominal — `anySize` means they are not enforced — but the unit is not: every class
// here is kg, because lei/kg is the only honest way to compare a 1 kg pack with loose weight.
// The per-piece goods (avocado by the bucată, corn on the cob, radishes by the legătură) are
// deliberately ABSENT: they are genuinely sold per item, and inventing a weight for them would
// be filling a gap with a plausible value.

export type ProduceClass = {
  slug: string;
  label: string;
  unit: "kg";
  unitSize: number;
  attributes: Record<string, unknown> & {
    require?: string[]; exclude?: string[]; anySize?: boolean;
    maxUnitSize?: number; minUnitSize?: number;
  };
};

/**
 * A fresh herb bunch weighs 20-50 g. An 8 g packet of the same word is DRIED seasoning, and
 * nothing in "Mărar Auchan, 8g" or "Busuioc Galeo 10g" says so — both were proposed into the
 * fresh classes. Weight is the only thing that separates them, so the herb classes carry a floor.
 */
const HERB_MIN_KG = 0.02;

/** Forms and preparations that are never the fresh item, whatever the head noun says. */
const NOT_FRESH = [
  "congelat", "conserva", "borcan", "murat", "muraturi", "compot", "suc", "nectar", "sirop",
  "piure", "pasta", "bulion", "sos", "supa", "ketchup", "chips", "snack", "uscat", "deshidratat",
  "iaurt", "prajitura", "baton", "musli", "cereale", "ciocolata", "inghetata", "bautura",
  "aroma", "gust de", "tortilla", "pizza", "salata de", "otet", "ulei", "sampon", "crema",
  "gem", "dulceata", "magiun", "jeleu", "biscuiti", "napolitane", "fulgi", "faina", "pudra",
  // Found by audit:basket-classes: "Pulpa de rosii Cirio 400 g" (tinned) was pricing the
  // fresh-tomato line, and "Ceapa granulata" the onion line. Both are processed forms whose
  // names never say "conserva".
  "granulat", "pulpa", "condiment", "praf", "rondele", "cuburi",
  // Preserved forms that the catalog files as FRESH and are not: "Naturavit Castraveți în
  // saramură" and "Răureni Spanac în saramură" both sit in a fresh leaf, and "Bonduelle Sfeclă
  // roșie rondele" is a cooked slice. Each was proposed into a fresh class on the dry run.
  "saramura", "rondele", "taiat", "feliat", "curatat", "decojit", "in ulei", "in otet",
  "depelat", "crispy", "prajit", "pane", "wedges", "cuburi", "intreg", "passata", "pasat",
  // Added 2026-10-03, found by the brand-aware lead-token fix exposing real gaps: "Kimchi de
  // morcovi" (fermented, not fresh — and the SAME brand does it to carrots, beets and radishes),
  // "Dulcegarie de căpșuni" (candy), "METRO Chef Tartă Vișine" (a cake), "Danonino Brânzică
  // Caise & Căpșuni" (a kids' dairy snack merely flavoured with the fruit), "RIOBA Briosă Afine"
  // (a muffin), "Fine Life Miniprăjitura Căpșuni" / "METRO Chef Topping Căpșuni" (a cake, a
  // dessert sauce). None of these is the fruit itself.
  "kimchi", "dulcegarie", "tarta", "branzica", "briose", "topping", "miniprajitura", "ceai",
];

/**
 * The ceiling for a loose class, in kg. A 10 kg catering sack of onions is not the kilo of
 * onions a shopper is pricing, and `anySize` without a cap merged the two.
 */
const LOOSE_MAX_KG = 2.5;

/**
 * …and a FLOOR, for the same reason there is a ceiling.
 *
 * `audit:basket-classes` caught "Ceapa granulata Kamis 20g" pricing the "ceapă galbenă, la kg"
 * basket line — a 20 g jar of dried seasoning standing in for a kilo of onions, a 100x size
 * spread inside one class. `maxUnitSize` could not see it because it only looks upward.
 *
 * 150 g is below any single piece of loose produce a shop sells (a tomato is ~200 g, a banana
 * ~200 g) and above every spice jar. Herbs override this with their own, much lower, floor —
 * they are genuinely sold in 20-50 g bunches.
 */
const LOOSE_MIN_KG = 0.15;

const BIO = ["bio", "eco", "organic"];

/** A conventional (non-BIO) class for a weight-sold fresh item. */
function fresh(slug: string, label: string, require: string[], extraExclude: string[] = []): ProduceClass {
  return {
    slug, label, unit: "kg", unitSize: 1,
    attributes: { anySize: true, maxUnitSize: LOOSE_MAX_KG, minUnitSize: LOOSE_MIN_KG, require, exclude: [...NOT_FRESH, ...BIO, ...extraExclude] },
  };
}

/** The BIO/ECO twin of a fresh class — kept separate because the price gap is the point. */
function freshBio(slug: string, label: string, require: string[], extraExclude: string[] = []): ProduceClass {
  return {
    slug, label, unit: "kg", unitSize: 1,
    attributes: { anySize: true, maxUnitSize: LOOSE_MAX_KG, minUnitSize: LOOSE_MIN_KG, require: [...require, BIO.join("|")], exclude: [...NOT_FRESH, ...extraExclude] },
  };
}

/** A fresh herb: same as `fresh`, but with a weight floor that keeps dried sachets out. */
function herb(slug: string, label: string, require: string[], extraExclude: string[] = []): ProduceClass {
  const k = fresh(slug, label, require, extraExclude);
  return { ...k, attributes: { ...k.attributes, minUnitSize: HERB_MIN_KG } };
}

/** A fresh berry: same as `fresh`, but with a lower floor — berries' own standard pack is a
 *  125 g punnet, below `LOOSE_MIN_KG` (0.15), and neither is sold dried under these names. */
function berry(slug: string, label: string, require: string[], extraExclude: string[] = []): ProduceClass {
  const k = fresh(slug, label, require, extraExclude);
  return { ...k, attributes: { ...k.attributes, minUnitSize: 0.1 } };
}

export const PRODUCE_CLASSES: ProduceClass[] = [
  // ── fruit ─────────────────────────────────────────────────────────────────────
  fresh("banane-kg", "Banane, la kg", ["banane"], ["rosii", "dole chips"]),
  freshBio("banane-bio-kg", "Banane BIO, la kg", ["banane"], ["rosii"]),

  // Apple VARIETY is a real price difference and the catalog states it, so each is its own
  // class and the generic class excludes them all rather than absorbing them.
  fresh("mere-golden-kg", "Mere Golden, la kg", ["mere", "golden"]),
  fresh("mere-gala-kg", "Mere Gala, la kg", ["mere", "gala"]),
  fresh("mere-idared-kg", "Mere Idared, la kg", ["mere", "idared"]),
  fresh("mere-granny-kg", "Mere Granny Smith, la kg", ["mere", "granny"]),
  fresh("mere-rosii-kg", "Mere roșii, la kg", ["mere", "rosii"], ["golden", "gala", "idared", "granny", "punga", "plasa"]),
  fresh("mere-kg", "Mere, la kg", ["mere"], ["golden", "gala", "idared", "granny", "rosii", "punga", "plasa", "banane"]),
  freshBio("mere-bio-kg", "Mere BIO, la kg", ["mere"]),

  fresh("pere-kg", "Pere, la kg", ["pere"], ["punga", "plasa"]),
  fresh("struguri-kg", "Struguri, la kg", ["struguri"], ["stafide"]),
  fresh("prune-kg", "Prune, la kg", ["prune"], ["uscate"]),
  fresh("piersici-kg", "Piersici, la kg", ["piersici"]),
  fresh("nectarine-kg", "Nectarine, la kg", ["nectarine"]),
  fresh("caise-kg", "Caise, la kg", ["caise"]),
  fresh("cirese-kg", "Cireșe, la kg", ["cirese"]),
  fresh("visine-kg", "Vișine, la kg", ["visine"]),
  fresh("capsuni-kg", "Căpșuni, la kg", ["capsuni"]),
  berry("zmeura-kg", "Zmeură, la kg", ["zmeura"]),
  berry("afine-kg", "Afine, la kg", ["afine"]),
  fresh("portocale-kg", "Portocale, la kg", ["portocale"], ["suc de", "rosii"]),
  fresh("mandarine-kg", "Mandarine, la kg", ["mandarine"]),
  fresh("lamai-kg", "Lămâi, la kg", ["lamai|lamaie"], ["limes"]),
  fresh("limes-kg", "Lime, la kg", ["limes|lime"]),
  fresh("grapefruit-kg", "Grapefruit, la kg", ["grapefruit"]),
  fresh("kiwi-kg", "Kiwi, la kg", ["kiwi"]),
  fresh("ananas-kg", "Ananas, la kg", ["ananas"]),
  fresh("mango-kg", "Mango, la kg", ["mango"]),
  fresh("pepene-kg", "Pepene, la kg", ["pepene"]),

  // ── vegetables ────────────────────────────────────────────────────────────────
  // Origin is a discriminator here, not a description: "românești" commands a real premium.
  fresh("rosii-romanesti-kg", "Roșii românești, la kg", ["rosii", "romanesti"], ["cherry", "roze", "uscate"]),
  fresh("rosii-cherry-kg", "Roșii cherry, la kg", ["rosii", "cherry"], ["uscate"]),
  // `tortelloni` added 2026-10-03: "Antica Corte Tortelloni roșii și mozzarella" is stuffed
  // pasta, not tomatoes, and newly qualified once the brand-aware lead-token fix stopped
  // rejecting it on the brand prefix alone — "roșii" is genuinely its second significant token.
  fresh("rosii-kg", "Roșii, la kg", ["rosii"], ["romanesti", "cherry", "roze", "uscate", "mere", "banane", "coacaze", "fasole", "varza", "sfecla", "ridichi", "portocale", "struguri", "ceapa", "cartofi", "ardei", "vin", "ceai", "tortelloni", "ravioli", "paste"]),
  freshBio("rosii-bio-kg", "Roșii BIO, la kg", ["rosii"], ["mere", "banane", "coacaze", "fasole", "varza"]),

  // `congelat`/`preprajit`/`crinkle`/`chips` added 2026-10-03: previously kept out only by
  // accident — the lead-token check rejected every branded frozen-fries line ("aro Cartofi
  // Crinkle", "METRO Chef Cartofi Congelati", "Edenia Cartofi preprajiti") because the brand
  // sat before "cartofi" in the name. Making that check brand-aware (propose-equivalence.ts)
  // removed the accident and exposed that the real exclude list never named this whole
  // category: raw potatoes and frozen oven fries are not the same purchase, and `prajit` alone
  // does not catch `preprajiti` (the exclude match is a word-PREFIX check; "pre" is a different
  // prefix). Measured via a live catalog scan before writing this, not assumed.
  // `raclette|cuburi|triunghiuri|criss cross|sidewinders|bacon|mozzarella|demibagheta|galuste|
  // la cuptor` added for the same reason as `cartofi-1kg` in seed-equivalence.ts: METRO Chef's
  // frozen catering line marks "frozen" with a UI snowflake glyph `normalizeRo` strips before
  // any exclude check runs, leaving only the shape name to match on.
  fresh("cartofi-albi-kg", "Cartofi albi, la kg", ["cartofi"],
    ["dulci", "noi", "rosii", "pai", "sac", "punga", "plasa", "wedges", "prajit", "congelat", "preprajit", "crinkle", "chips", "gratinat", "duchess", "dipper", "spirala", "steakhouse", "scoops",
     "raclette", "cuburi", "triunghiuri", "criss cross", "sidewinders", "bacon", "mozzarella", "demibagheta", "galuste", "la cuptor"]),
  fresh("cartofi-noi-kg", "Cartofi noi, la kg", ["cartofi", "noi"], ["dulci", "pai"]),
  fresh("cartofi-dulci-kg", "Cartofi dulci, la kg", ["cartofi", "dulci"]),
  freshBio("cartofi-bio-kg", "Cartofi BIO, la kg", ["cartofi"], ["pai", "prajit"]),

  // `pringles` added 2026-10-03: "Pringles Cascaval & Ceapa" is cheese-and-onion flavoured
  // crisps, not onions — the same brand-collision shape already fixed for `cascaval-400g`.
  fresh("ceapa-galbena-kg", "Ceapă galbenă, la kg", ["ceapa"], ["rosie", "verde", "plasa", "punga", "praf", "inele", "pringles"]),
  // `chutney` added: a preserved condiment, not fresh onion.
  fresh("ceapa-rosie-kg", "Ceapă roșie, la kg", ["ceapa", "rosie"], ["verde", "praf", "chutney"]),
  freshBio("ceapa-bio-kg", "Ceapă BIO, la kg", ["ceapa"], ["praf", "inele"]),

  fresh("usturoi-kg", "Usturoi, la kg", ["usturoi"], ["granulat", "praf", "sos", "pasta", "solo"]),
  fresh("usturoi-solo-kg", "Usturoi Solo, la kg", ["usturoi", "solo"]),
  fresh("morcovi-kg", "Morcovi, la kg", ["morcovi"], ["baby", "plasa", "punga", "rondele"]),
  freshBio("morcovi-bio-kg", "Morcovi BIO, la kg", ["morcovi"], ["rondele"]),
  fresh("ardei-kg", "Ardei, la kg", ["ardei"], ["iute", "praf", "boia", "umplut"]),
  fresh("castraveti-kg", "Castraveți, la kg", ["castraveti"], ["cornichon", "murat"]),
  fresh("vinete-kg", "Vinete, la kg", ["vinete"], ["salata de", "zacusca"]),
  fresh("dovlecei-kg", "Dovlecei, la kg", ["dovlecei|dovlecel"]),
  fresh("varza-kg", "Varză, la kg", ["varza"], ["murata", "acra", "kale"]),
  fresh("conopida-kg", "Conopidă, la kg", ["conopida"]),
  fresh("broccoli-kg", "Broccoli, la kg", ["broccoli"]),
  fresh("telina-kg", "Țelină, la kg", ["telina"]),
  // `salatuca` added: a prepared beet-and-horseradish relish, not the fresh root.
  fresh("sfecla-kg", "Sfeclă roșie, la kg", ["sfecla"], ["salatuca"]),
  fresh("praz-kg", "Praz, la kg", ["praz"]),
  fresh("ridichi-kg", "Ridichi, la kg", ["ridichi"]),
  // `supa`/`felii`/`salata` added 2026-10-03: `NOT_FRESH` already has `sos` but not the separate
  // word `supa` (soup), and `feliat` (adj.) does not word-prefix-match `felii` (noun) — both
  // real gaps the brand-aware lead-token fix exposed ("FRUFRU Supa de ciuperci", "METRO Chef
  // Ciuperci Felii 2500 g").
  fresh("ciuperci-kg", "Ciuperci champignon, la kg", ["ciuperci"], ["conserva", "pleurotus", "shiitake", "supa", "felii", "salata"]),
  fresh("fasole-verde-kg", "Fasole verde, la kg", ["fasole", "verde"], ["boabe", "rosie", "alba"]),
  // NO FRESH PEA OR SWEETCORN CLASS. Both existed and both were entirely wrong.
  //
  // `mazare-kg` held 23 live products and `porumb-kg` held 18, and EVERY ONE of them was a tin
  // or a bag of popcorn: "Mazare cu carne de vita Auchan 300 g", "Porumb pentru floricele Andra,
  // 200 g", "Porumb baby Auchan, 190 g". Their exclusion lists named "conserva", and none of
  // these products says "conserva" — they say "boabe", "in vid", "in saramura". The catalog
  // carries no fresh peas and no corn on the cob at all, so the classes could only ever fill
  // with the processed forms that share the head noun.
  //
  // Same decision as the fresh herbs above: a class that is mostly wrong is worse than no class.
  // The tinned versions now have their own classes, with sizes and forms stated, in
  // src/data/private-label-classes.ts.

  // ── leaves ────────────────────────────────────────────────────────────────────
  // NO FRESH-HERB CLASSES. Pătrunjel, mărar and busuioc were written and then removed: the
  // catalog for those words is dominated by dried sachets ("Busuioc Galeo 10g") and frozen
  // packs ("Frosta Mărar 85 g", "Orogel Pătrunjel 75 g"), and nothing in the NAME separates
  // them from the fresh bunch. A weight floor caught the 8 g sachets and the frozen ones
  // walked straight through it. A class that is mostly wrong is worse than no class, and
  // fresh herbs are sold by legătură rather than by weight anyway — so they stay unclassed,
  // which is the honest answer rather than a forced one.
  // MEASURED DANGEROUS, 2026-10-03: this head-noun cluster is dominated by prepared deli salads
  // sold in small jars — fish-roe salad (Bonito/Deltaica/Doripesco/Negro/Pescaria), tuna salad
  // (Rio Mare/Home Garden), pickled beet salad, Russian salad ("boeuf"/"à la russe") — none of
  // which a shopper substitutes for fresh lettuce, and the old exclude list (`mix`, `de`,
  // `iceberg`, `rucola`, `baby`) named none of it. The brand-aware lead-token fix
  // (propose-equivalence.ts) exposed this: those exact products had been kept out only because
  // their brand prefix broke the OLD lead check by accident, not because this rule named them.
  // Requiring `verde` would ALSO exclude genuine fresh-lettuce lines that never say the word
  // ("Salata frunza de stejar", "Salata Mix Roman Eisberg"), so the fix is a long, specific
  // exclude list against what is actually in the catalog, not a positive-word requirement.
  fresh("salata-verde-kg", "Salată verde, la kg", ["salata"],
    ["mix", "de", "iceberg", "rucola", "baby",
     "icre", "ton", "hering", "stiuca", "sfecla", "boeuf", "russe", "orientala", "ganoush",
     "saksuka", "maioneza", "otet", "cuscus", "linte", "mexican", "texana", "aperitiv", "quinoa"]),
  fresh("salata-iceberg-kg", "Salată iceberg, la kg", ["salata", "iceberg"]),
  herb("rucola-kg", "Rucola, la kg", ["rucola"]),
  herb("spanac-kg", "Spanac, la kg", ["spanac"], ["congelat", "tocat"]),
];
