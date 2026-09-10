// ── PHASE 1b, BATCH 1. Written against names actually in the catalog, never from memory.
//
// The brief asked for batches of 40 drawn from Phase 1a's 60 "plausible" groups. **The shortlist
// does not support 40 defensible classes, and this file is the honest size of what it does
// support.** Every group was read; most failed the brief's own rule that a class may not merge
// different variety, form or fat content:
//
//   fixativ 0.25l    31 products, 5 shops — but Taft Ultimate, Taft Power&Fullness, Nivea Diamond
//                    Gloss, Nivea Volum and Syoss Max Hold are variants with different hold
//                    levels, and "nivel fixare 5+" is printed on the pack. A branded-variant merge
//                    is the exact shape CLAUDE.md's golden set exists to prevent.
//   humus 0.2kg      41 products and almost all Sezamo. Flavours (jalapeño, pesto, sfeclă, zatar,
//                    țelină) drive the choice, and a class resolving to one shop is not a
//                    comparison.
//   smoothie 0.25l   flavours again, and the group mixes `kg` with `l`.
//   cozonac 0.45kg   38 products, 6 shops — but the filling is the product (cacao, nucă, rahat,
//                    caramel, mac). Arguable, therefore kept apart per the brief.
//   creveti 0.2kg    breaded, sushi, in oil, skewered, gyoza. One raw-shrimp line, one shop.
//   zmeura 0.1kg     mostly chocolate, yoghurt, biscuits — and a Dove deodorant and a depilatory
//                    cream. Same head-noun collision as lapte/lapte-de-corp.
//   bors 0.5-1.2l    **matched Borsec water** on the substring. Handled below by naming it out.
//
// What remains is small and real. Each class here has members at two or more merchants, an
// explicit size window with both bounds, and require/exclude written from the catalog's own
// vocabulary.

export type Klass = {
  slug: string;
  label: string;
  unit: string;
  unitSize: number;
  attributes: Record<string, unknown> & { require?: string[]; exclude?: string[] };
};

export const BATCH1_CLASSES: Klass[] = [
  // ══ CIDRU ═══════════════════════════════════════════════════════════════════════════════════
  //
  // Split by fruit, not merged. Pear cider and apple cider are not substitutes for someone who
  // wants one of them, and the catalog prices them the same, so merging would buy nothing and
  // risk a wrong substitution. Both classes have real cross-merchant members.
  //
  // `mar|mere` covers "Gold Cidru Mere", "MAR CIDRU", "Cidru din mere". Alcohol-free and the
  // 0,5 l cans are outside the window by construction.
  {
    slug: "cidru-mere-033",
    label: "Cidru de mere, 0,33 l",
    unit: "l",
    unitSize: 0.33,
    attributes: {
      fruct: "mere",
      strictRules: true,
      minUnitSize: 0.32,
      maxUnitSize: 0.34,
      require: ["cidru", "mar|mere|gold"],
      exclude: ["pere|pear|afine|coacaze|mure|padure|capsun|zmeura|otet|suc|must|fara alcool"],
    },
  },
  {
    slug: "cidru-pere-033",
    label: "Cidru de pere, 0,33 l",
    unit: "l",
    unitSize: 0.33,
    attributes: {
      fruct: "pere",
      strictRules: true,
      minUnitSize: 0.32,
      maxUnitSize: 0.34,
      require: ["cidru", "pere|pear"],
      exclude: ["mere|mar|afine|coacaze|mure|padure|capsun|zmeura|otet|suc|must|fara alcool"],
    },
  },

  // ══ TOFU ════════════════════════════════════════════════════════════════════════════════════
  //
  // PLAIN tofu only. Smoked tofu is a different product with a different price, and the flavoured
  // range (trufe, mărar, busuioc, telemea, Asia) is variant, not pack. Burgers, gyoza and
  // "cremos" are different products that merely contain tofu — the `cu` trap CLAUDE.md names.
  {
    slug: "tofu-natur-300g",
    label: "Tofu natur, 300 g",
    unit: "kg",
    unitSize: 0.3,
    attributes: {
      tip: "natur",
      strictRules: true,
      minUnitSize: 0.28,
      maxUnitSize: 0.32,
      require: ["tofu"],
      exclude: [
        "afumat|fumat|marinat|condimentat|cremos|matase|silken",
        "burger|gyoza|snitel|crocant|pane|salata|wok|stir|paste|supa|desert|budinca",
        "trufe|marar|busuioc|telemea|asia|curry|paprika|ierburi|masline|ardei|rosii|susan",
      ],
    },
  },

  // ══ BUSUIOC USCAT ═══════════════════════════════════════════════════════════════════════════
  //
  // The 30 g jar of DRIED basil, which is what "Busuioc 30 g" is at four merchants. Frozen basil
  // (Orogel) and fresh potted basil are different goods sold at different prices; seasoning mixes
  // that merely contain basil are the `cu` trap again.
  {
    slug: "busuioc-uscat-30g",
    label: "Busuioc uscat, 30 g",
    unit: "kg",
    unitSize: 0.03,
    attributes: {
      forma: "uscat",
      strictRules: true,
      minUnitSize: 0.025,
      maxUnitSize: 0.04,
      require: ["busuioc"],
      exclude: [
        "congelat|proaspat|ghiveci|legatura|planta|seminte",
        "mix|amestec|sos|pesto|paste|chips|sticks|popcrop|ulei|otet|rosii|usturoi|oregano",
      ],
    },
  },

  // ══ BORȘ ════════════════════════════════════════════════════════════════════════════════════
  //
  // **`bors` is a substring of `borsec`**, and the Phase 1a grouping duly put four Borsec mineral
  // waters in with the soup souring agent. That is the lapte/lapte-de-corp collision in a second
  // place, and it is named out explicitly rather than left to chance.
  //
  // "Borș de pută", "borș acru", "borș nepasteurizat" and the Danilă drinking borș are all the
  // same trade at 1 l. The flavoured drinking ones (cu telină, cu roșii, cu leuștean) are kept
  // out: they are seasoned variants at a different price.
  {
    slug: "bors-acru-1l",
    label: "Borș acru, 1 l",
    unit: "l",
    unitSize: 1,
    attributes: {
      tip: "acru",
      strictRules: true,
      minUnitSize: 0.9,
      maxUnitSize: 1.1,
      require: ["bors"],
      exclude: [
        "borsec",
        "apa|minerala|carbogazoas|plata|izvor",
        "telina|rosii|leustean|magiun|instant|praf|pulbere|granule|cuburi|concentrat",
      ],
    },
  },

  // ══ CARTOFIORI ══════════════════════════════════════════════════════════════════════════════
  //
  // The 800 g jar of Covasna-style baby potatoes, three merchants, and the seasoning (sare,
  // rozmarin, mărar & usturoi) does not move the price — all three sit at 9,90. `picanti` does
  // (13,79) and is excluded: a spicy jar is a different choice at a different price, which is the
  // brief's "different variety where it drives price".
  {
    slug: "cartofiori-800g",
    label: "Cartofiori la borcan, 800 g",
    unit: "kg",
    unitSize: 0.8,
    attributes: {
      tip: "borcan",
      strictRules: true,
      minUnitSize: 0.75,
      maxUnitSize: 0.85,
      require: ["cartofiori"],
      exclude: ["picant|iute|chili|congelat|pai|chips|prajit|wedges|piure"],
    },
  },

  // ══ LIPIE ═══════════════════════════════════════════════════════════════════════════════════
  //
  // Split white from graham, because that is a flour difference and the brief names făină 000 vs
  // 650 as a merge that may not happen. Both are 500 g flatbreads at two or three merchants.
  {
    slug: "lipie-alba-500g",
    label: "Lipie albă, 500 g",
    unit: "kg",
    unitSize: 0.5,
    attributes: {
      tip: "alba",
      strictRules: true,
      minUnitSize: 0.45,
      maxUnitSize: 0.55,
      require: ["lipie"],
      exclude: ["graham|integral|secara|carne|tocata|piadina|umpluta|cu branza|cu sunca"],
    },
  },
  {
    slug: "lipie-graham-500g",
    label: "Lipie graham, 500 g",
    unit: "kg",
    unitSize: 0.5,
    attributes: {
      tip: "graham",
      strictRules: true,
      minUnitSize: 0.45,
      maxUnitSize: 0.55,
      require: ["lipie", "graham"],
      exclude: ["carne|tocata|piadina|umpluta|cu branza|cu sunca"],
    },
  },
];

// ── TWO EXISTING CLASSES WHOSE WINDOW IS WRONG, AND WHY THIS IS A CORRECTION NOT A LOOSENING.
//
// `afine-kg` and `zmeura-kg` carry `minUnitSize: 0.15`. Fresh berries in this catalog are sold in
// a **125 g punnet** — "Afine caserola 125 g" at three merchants, "Zmeura la caserola, 125 g" —
// so the floor excludes precisely the standard pack of the thing the class is for. Phase 1a
// predicted this shape: a class catching a minority of its own group has a window that is too
// tight.
//
// The floor exists for a real reason, stated in `produce-classes.ts`: an 8 g packet of "Mărar" is
// DRIED seasoning and weight is the only thing that tells it apart from a fresh bunch. That
// reason does not apply to berries, which are not sold dried in this catalog under these names,
// and the classes' own exclude lists already name out dried, frozen, jam and chocolate.
//
// Lowering it to 0.10 admits the punnet and nothing else. The audit prints every member so the
// claim is checkable rather than asserted.
export const WINDOW_CORRECTIONS: { slug: string; minUnitSize: number; why: string }[] = [
  { slug: "afine-kg", minUnitSize: 0.1, why: "125 g punnet is the standard fresh pack; 0.15 floor excluded it" },
  { slug: "zmeura-kg", minUnitSize: 0.1, why: "125 g punnet is the standard fresh pack; 0.15 floor excluded it" },
];
