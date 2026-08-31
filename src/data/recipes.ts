// Preset recipes → their shopping ingredients (generic search terms that resolve to
// real catalog products via /api/suggest). Adding a recipe fills the active cart, then
// the /lista optimizer finds the cheapest store(s).
export type Recipe = { slug: string; name: string; emoji: string; ingredients: string[] };

export const RECIPES: Recipe[] = [
  { slug: "mic-dejun", name: "Mic dejun clasic", emoji: "🍳", ingredients: ["oua", "lapte", "unt", "paine", "cascaval", "sunca"] },
  { slug: "sarmale", name: "Sarmale", emoji: "🥬", ingredients: ["carne tocata", "orez", "varza murata", "ceapa", "bulion", "ulei"] },
  { slug: "salata-boeuf", name: "Salată de boeuf", emoji: "🥗", ingredients: ["cartofi", "morcovi", "mazare", "muraturi", "maioneza", "piept de pui"] },
  { slug: "paste-carbonara", name: "Paste carbonara", emoji: "🍝", ingredients: ["paste", "bacon", "oua", "parmezan", "smantana"] },
  { slug: "ciorba-legume", name: "Ciorbă de legume", emoji: "🍲", ingredients: ["morcovi", "cartofi", "ceapa", "ardei", "rosii", "smantana"] },
  { slug: "clatite", name: "Clătite", emoji: "🥞", ingredients: ["faina", "lapte", "oua", "zahar", "ulei", "gem"] },
  { slug: "gratar", name: "Grătar", emoji: "🍖", ingredients: ["mici", "carnati", "ceafa de porc", "paine", "mustar", "bere"] },
  { slug: "prajitura", name: "Prăjitură de casă", emoji: "🍰", ingredients: ["faina", "zahar", "oua", "unt", "cacao", "praf de copt"] },
];
