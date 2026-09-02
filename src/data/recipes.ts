// Fifteen Romanian recipes, expressed as NEEDS rather than products.
//
// WHAT CHANGED AND WHY. A recipe used to carry free-text ingredients ("oua", "lapte") which were
// resolved by hitting /api/suggest and taking the first search result. That put the choice in the
// search ranker, at a moment when nothing was known about the shopper: it could not prefer a
// favourite, could not prefer private label, could not compare per-unit price across shops, and
// silently added whatever happened to rank first. Two people adding the same recipe got the same
// product regardless of what either of them buys.
//
// Each ingredient now names an EquivalenceClass — the need — and `resolveLine` picks the product
// against the shopper's own context. The recipe says "eggs, ten of them"; the engine says which
// eggs, and the UI says why.
//
// `classSlug` must exist in `EquivalenceClass` (seeded by `npm run seed:equivalence`), and
// `npm run audit:recipes` fails when one does not resolve — a recipe naming a class we cannot
// fill is a recipe that adds an empty line to somebody's basket.

export type RecipeIngredient = {
  /** EquivalenceClass.slug — the need, not a product. */
  classSlug: string;
  /** How many of the class's canonical packs. */
  qty: number;
  /** Shown in the recipe card before anything is resolved. */
  label: string;
};

export type Recipe = {
  slug: string;
  name: string;
  emoji: string;
  /** A line of context, so the card is not just a list. */
  note: string;
  ingredients: RecipeIngredient[];
};

export const RECIPES: Recipe[] = [
  {
    slug: "mic-dejun-clasic", name: "Mic dejun clasic", emoji: "🍳",
    note: "Ouă, pâine, unt și cașcaval — micul dejun de zi cu zi.",
    ingredients: [
      { classSlug: "oua-m-10", qty: 1, label: "Ouă M, 10 buc" },
      { classSlug: "paine-alba-500g", qty: 1, label: "Pâine albă" },
      { classSlug: "unt-200g", qty: 1, label: "Unt" },
      { classSlug: "cascaval-400g", qty: 1, label: "Cașcaval" },
      { classSlug: "lapte-integral-1l", qty: 1, label: "Lapte integral" },
    ],
  },
  {
    slug: "omleta", name: "Omletă cu brânză", emoji: "🍳",
    note: "Cinci minute, trei ingrediente.",
    ingredients: [
      { classSlug: "oua-m-10", qty: 1, label: "Ouă M, 10 buc" },
      { classSlug: "branza-telemea-400g", qty: 1, label: "Telemea" },
      { classSlug: "unt-200g", qty: 1, label: "Unt" },
    ],
  },
  {
    slug: "clatite", name: "Clătite", emoji: "🥞",
    note: "Aluatul clasic: făină, lapte, ouă, zahăr.",
    ingredients: [
      { classSlug: "faina-alba-1kg", qty: 1, label: "Făină albă" },
      { classSlug: "lapte-integral-1l", qty: 1, label: "Lapte integral" },
      { classSlug: "oua-m-10", qty: 1, label: "Ouă M, 10 buc" },
      { classSlug: "zahar-tos-1kg", qty: 1, label: "Zahăr" },
      { classSlug: "ulei-floarea-soarelui-1l", qty: 1, label: "Ulei" },
    ],
  },
  {
    slug: "paste-simple", name: "Paste cu unt și cașcaval", emoji: "🍝",
    note: "Cina de luni seara.",
    ingredients: [
      { classSlug: "paste-500g", qty: 1, label: "Paste" },
      { classSlug: "unt-200g", qty: 1, label: "Unt" },
      { classSlug: "cascaval-400g", qty: 1, label: "Cașcaval" },
      { classSlug: "sare-1kg", qty: 1, label: "Sare" },
    ],
  },
  {
    slug: "paste-rosii", name: "Paste cu sos de roșii", emoji: "🍝",
    note: "Roșii proaspete, ceapă, ulei.",
    ingredients: [
      { classSlug: "paste-500g", qty: 1, label: "Paste" },
      { classSlug: "rosii-1kg", qty: 1, label: "Roșii" },
      { classSlug: "ceapa-1kg", qty: 1, label: "Ceapă" },
      { classSlug: "ulei-floarea-soarelui-1l", qty: 1, label: "Ulei" },
    ],
  },
  {
    slug: "mamaliga-branza", name: "Mămăligă cu brânză și smântână", emoji: "🌽",
    note: "Mălai, telemea, smântână. Nimic altceva.",
    ingredients: [
      { classSlug: "malai-1kg", qty: 1, label: "Mălai" },
      { classSlug: "branza-telemea-400g", qty: 1, label: "Telemea" },
      { classSlug: "smantana-200g", qty: 1, label: "Smântână" },
      { classSlug: "sare-1kg", qty: 1, label: "Sare" },
    ],
  },
  {
    slug: "orez-cu-legume", name: "Orez cu legume", emoji: "🍚",
    note: "Garnitură simplă, se ține o săptămână.",
    ingredients: [
      { classSlug: "orez-bob-lung-1kg", qty: 1, label: "Orez" },
      { classSlug: "ceapa-1kg", qty: 1, label: "Ceapă" },
      { classSlug: "rosii-1kg", qty: 1, label: "Roșii" },
      { classSlug: "ulei-floarea-soarelui-1l", qty: 1, label: "Ulei" },
    ],
  },
  {
    slug: "salata-rosii-telemea", name: "Salată de roșii cu telemea", emoji: "🥗",
    note: "Vara, de trei ori pe săptămână.",
    ingredients: [
      { classSlug: "rosii-1kg", qty: 1, label: "Roșii" },
      { classSlug: "branza-telemea-400g", qty: 1, label: "Telemea" },
      { classSlug: "ceapa-1kg", qty: 1, label: "Ceapă" },
      { classSlug: "ulei-floarea-soarelui-1l", qty: 1, label: "Ulei" },
    ],
  },
  {
    slug: "prajitura-de-casa", name: "Prăjitură de casă", emoji: "🍰",
    note: "Blat simplu: făină, zahăr, ouă, unt, lapte.",
    ingredients: [
      { classSlug: "faina-alba-1kg", qty: 1, label: "Făină albă" },
      { classSlug: "zahar-tos-1kg", qty: 1, label: "Zahăr" },
      { classSlug: "oua-m-10", qty: 1, label: "Ouă M, 10 buc" },
      { classSlug: "unt-200g", qty: 1, label: "Unt" },
      { classSlug: "lapte-integral-1l", qty: 1, label: "Lapte integral" },
    ],
  },
  {
    slug: "iaurt-cu-fructe", name: "Iaurt grecesc cu mere", emoji: "🥣",
    note: "Micul dejun rapid.",
    ingredients: [
      { classSlug: "iaurt-grecesc-400g", qty: 1, label: "Iaurt grecesc" },
      { classSlug: "mere-1kg", qty: 1, label: "Mere" },
    ],
  },
  {
    slug: "cafea-si-lapte", name: "Cafea cu lapte", emoji: "☕",
    note: "Cafea măcinată și lapte. Dimineața.",
    ingredients: [
      { classSlug: "cafea-macinata-250g", qty: 1, label: "Cafea măcinată" },
      { classSlug: "lapte-semi-1l", qty: 1, label: "Lapte semidegresat" },
      { classSlug: "zahar-tos-1kg", qty: 1, label: "Zahăr" },
    ],
  },
  {
    slug: "cumparaturi-saptamanale", name: "Coșul săptămânal", emoji: "🧺",
    note: "Bazele: lapte, pâine, ouă, ulei, făină, zahăr.",
    ingredients: [
      { classSlug: "lapte-integral-1l", qty: 2, label: "Lapte integral ×2" },
      { classSlug: "paine-alba-500g", qty: 1, label: "Pâine albă" },
      { classSlug: "oua-m-10", qty: 1, label: "Ouă M, 10 buc" },
      { classSlug: "ulei-floarea-soarelui-1l", qty: 1, label: "Ulei" },
      { classSlug: "faina-alba-1kg", qty: 1, label: "Făină albă" },
      { classSlug: "zahar-tos-1kg", qty: 1, label: "Zahăr" },
    ],
  },
  {
    slug: "curatenie", name: "Curățenie de weekend", emoji: "🧼",
    note: "Detergent de rufe și hârtie igienică — nu e mâncare, dar e în coș.",
    ingredients: [
      { classSlug: "detergent-rufe-3l", qty: 1, label: "Detergent de rufe" },
      { classSlug: "hartie-igienica-8", qty: 1, label: "Hârtie igienică" },
    ],
  },
  {
    slug: "gratar", name: "Grătar de weekend", emoji: "🍖",
    note: "Carne de porc, pâine, bere, ceapă.",
    ingredients: [
      { classSlug: "carne-porc-1kg", qty: 1, label: "Carne de porc" },
      { classSlug: "paine-alba-500g", qty: 1, label: "Pâine albă" },
      { classSlug: "bere-blonda-500ml", qty: 4, label: "Bere blondă ×4" },
      { classSlug: "ceapa-1kg", qty: 1, label: "Ceapă" },
    ],
  },
  {
    // Deliberately included even though our catalog serves it badly. `audit:recipes` reports it
    // as a bad recipe FOR OUR CATALOG rather than pretending otherwise — see item 6 of the brief.
    slug: "pui-cu-cartofi", name: "Pui cu cartofi la cuptor", emoji: "🍗",
    note: "Clasicul de duminică.",
    ingredients: [
      { classSlug: "piept-pui-1kg", qty: 1, label: "Piept de pui" },
      { classSlug: "cartofi-1kg", qty: 2, label: "Cartofi ×2" },
      { classSlug: "ceapa-1kg", qty: 1, label: "Ceapă" },
      { classSlug: "ulei-floarea-soarelui-1l", qty: 1, label: "Ulei" },
      { classSlug: "sare-1kg", qty: 1, label: "Sare" },
    ],
  },
];
