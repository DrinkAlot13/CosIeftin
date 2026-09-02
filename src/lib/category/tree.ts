// The grocery tree: 11 departments, 62 subcategories, from docs/TAXONOMY-PROPOSAL.md.
//
// Each leaf carries the words that identify it. Those words are the ASSIGNER'S ONLY INPUT, so
// they are written here beside the label rather than buried in the assigner — a taxonomy whose
// matching rules live somewhere else is one nobody can review, and reviewing it is the whole
// point of the proposal step.
//
// `match`  — any of these in the product name proposes this leaf. The FIRST token of the name
//            (the head noun, which Romanian puts first) counts for much more; see assign.ts.
// `avoid`  — any of these disqualifies the leaf outright. This is where the near-neighbours go,
//            and it is doing most of the precision work: "lapte" appears in body lotion, milk
//            chocolate and coffee creamer, and each of those belongs somewhere else.
//
// Matching is on `normalizeRo` output, so diacritics and punctuation are already folded and
// entries here are written without them.
//
// PLURALS: the assigner prefix-matches needles of 5+ characters, which covers "branza" ->
// "branzeturi" and "paine" -> "painea". It does NOT cover Romanian plurals that change the final
// vowel ("rodie" -> "rodii"), and it deliberately does not try: relaxing the rule to a shared
// stem would let "lapte" match "laptop". Where a plural is the form the catalog actually uses,
// write BOTH — that is cheap, exact, and reviewable.

export type Leaf = {
  slug: string;
  label: string;
  match: string[];
  avoid?: string[];
};

export type Department = {
  slug: string;
  label: string;
  icon: string;
  children: Leaf[];
};

/** Words that mean "this is a cosmetic / cleaning product", not food, wherever they appear. */
export const NON_FOOD_MARKERS = [
  "sampon", "gel de dus", "sapun", "deodorant", "crema de fata", "crema de corp", "lotiune",
  "pasta de dinti", "periuta", "detergent", "balsam de rufe", "odorizant", "servetele umede",
];

export const GROCERY_TREE: Department[] = [
  {
    slug: "fructe-legume", label: "Fructe și legume", icon: "🥬",
    children: [
      { slug: "fructe-proaspete", label: "Fructe proaspete", match: ["mere", "pere", "banane", "portocale", "lamai", "struguri", "capsuni", "piersici", "caise", "prune", "kiwi", "ananas", "pepene", "cirese", "visine", "mandarine", "grepfrut", "avocado", "rodie", "rodii", "smochine", "nectarine", "afine", "zmeura", "mure", "mango", "papaya", "lime", "fructe"], avoid: ["suc", "compot", "nectar", "gem", "dulceata", "iaurt", "congelat", "uscat", "chips", "sirop", "ceai", "bomboane", "aroma"] },
      { slug: "legume-proaspete", label: "Legume proaspete", match: ["rosii", "castraveti", "ardei", "ceapa", "usturoi", "cartofi", "morcovi", "varza", "conopida", "broccoli", "dovlecel", "vinete", "fasole verde", "mazare", "telina", "praz", "ridichi", "sfecla", "dovleac", "ciuperci", "porumb", "sparanghel", "andive", "gulie", "pastarnac", "legume"], avoid: ["conserva", "borcan", "murat", "congelat", "suc", "bulion", "pasta", "sos", "uscat", "chips", "supa"] },
      { slug: "verdeturi-salate", label: "Verdețuri și salate", match: ["salata", "spanac", "rucola", "patrunjel", "marar", "busuioc", "menta", "leustean", "verdeata"], avoid: ["conserva", "congelat", "uscat", "condiment", "seminte"] },
      { slug: "fructe-uscate-nuci", label: "Fructe uscate și nuci", match: ["nuci", "migdale", "alune", "fistic", "caju", "stafide", "curmale", "smochine uscate", "seminte", "arahide", "nuca", "cocos"], avoid: ["unt de arahide", "ulei", "lapte", "ciocolata"] },
      { slug: "legume-borcan", label: "Legume la borcan și murături", match: ["muraturi", "castraveti murati", "gogosari", "zacusca", "ardei iute borcan", "masline", "murata", "murate"], avoid: [] },
    ],
  },
  {
    slug: "carne-peste", label: "Carne și pește", icon: "🥩",
    children: [
      { slug: "pui-curcan", label: "Pui și curcan", match: ["pui", "curcan", "piept de pui", "pulpe", "aripioare", "rata", "gaina"], avoid: ["salam", "crenvursti", "parizer", "sunca", "pateu", "conserva", "supa", "cub", "hrana", "snacks"] },
      { slug: "porc", label: "Porc", match: ["porc", "ceafa", "cotlet", "fleica", "spata", "slanina"], avoid: ["salam", "crenvursti", "parizer", "sunca", "pateu", "conserva", "carnati"] },
      { slug: "vita-miel", label: "Vită și miel", match: ["vita", "vitel", "miel", "manzat"], avoid: ["salam", "pateu", "conserva", "cub", "supa"] },
      { slug: "peste-fructe-mare", label: "Pește și fructe de mare", match: ["peste", "somon", "ton", "macrou", "hering", "creveti", "calamar", "midii", "pastrav", "sardine", "merluciu", "dorada", "biban", "crap", "file de", "fish fingers", "sardeluta", "scrumbie", "sprot", "icre", "surimi"], avoid: ["ulei de peste", "hrana"] },
      { slug: "carne-tocata", label: "Carne tocată", match: ["carne tocata", "tocatura", "mici"], avoid: [] },
      { slug: "preparate-carne-cruda", label: "Preparate din carne crudă", match: ["snitel", "chiftele", "burger de", "pane crud"], avoid: [] },
    ],
  },
  {
    slug: "mezeluri", label: "Mezeluri", icon: "🥓",
    children: [
      { slug: "salam-carnati", label: "Salam și cârnați", match: ["salam", "carnati", "cabanos", "ghiudem", "babic", "sunca de praga", "mortadella", "lebar", "muschi tiganesc", "toba", "caltabos"], avoid: [] },
      { slug: "sunca-specialitati", label: "Șuncă și specialități", match: ["sunca", "jambon", "muschi file", "piept afumat", "pastrama", "kaizer", "bacon", "prosciutto", "salami"], avoid: [] },
      { slug: "crenvursti", label: "Crenvurști", match: ["crenvursti", "parizer", "hot dog"], avoid: [] },
      { slug: "pateuri-conserve-carne", label: "Pateuri și conserve din carne", match: ["pateu", "conserva de carne", "haleu", "pate"], avoid: [] },
    ],
  },
  {
    slug: "lactate-oua", label: "Lactate și ouă", icon: "🥛",
    children: [
      { slug: "lapte", label: "Lapte", match: ["lapte", "lapte praf"], avoid: ["lapte de corp", "lapte demachiant", "condensat", "ciocolata cu lapte", "pentru cafea", "cocos", "migdale", "ovaz", "soia", "orez", "bebe", "formula"] },
      { slug: "iaurt-sana", label: "Iaurt și sana", match: ["iaurt", "sana", "chefir", "kefir", "lapte batut"], avoid: ["inghetata", "chec", "prajitura"] },
      { slug: "branzeturi", label: "Brânzeturi", match: ["branza", "telemea", "mozzarella", "feta", "camembert", "gorgonzola", "ricotta", "mascarpone", "burduf", "urda", "emmentaler", "parmezan", "gouda", "cheddar", "brie"], avoid: ["chec", "tarta", "pizza", "snacks"] },
      { slug: "cascaval", label: "Cașcaval", match: ["cascaval"], avoid: ["pane", "snacks", "pizza"] },
      { slug: "smantana", label: "Smântână", match: ["smantana", "frisca", "crema pentru gatit", "crema de gatit", "crema vegetala", "crema uht"], avoid: [] },
      { slug: "unt-margarina", label: "Unt și margarină", match: ["unt", "margarina"], avoid: ["arahide", "cacao", "biscuiti", "fursec", "aluat", "shea", "corp"] },
      { slug: "oua", label: "Ouă", match: ["oua", "ou de"], avoid: ["ciocolata", "surpriza", "praf", "paste"] },
    ],
  },
  {
    slug: "panificatie", label: "Panificație", icon: "🍞",
    children: [
      { slug: "paine", label: "Pâine", match: ["paine", "franzela", "bagheta", "chifla", "chifle", "lipie"], avoid: ["pesmet", "crutoane", "faina"] },
      { slug: "toast-lipii", label: "Toast și lipii", match: ["toast", "lipie", "tortilla", "pita", "wrap"], avoid: [] },
      { slug: "cornuri-patiserie", label: "Cornuri și patiserie", match: ["corn", "croissant", "placinta", "strudel", "patiserie", "brioche", "gogoasa"], avoid: [] },
      { slug: "cozonac-checuri", label: "Cozonac și checuri", match: ["cozonac", "chec", "tort", "prajitura", "prajituri", "rulada", "ecler", "savarina", "savarine", "macarons", "amandine", "choux", "mousse", "tiramisu", "profiterol"], avoid: [] },
      { slug: "biscuiti-uscati", label: "Biscuiți uscați", match: ["pesmet", "crutoane", "paine prajita"], avoid: [] },
    ],
  },
  {
    slug: "bacanie", label: "Băcănie", icon: "🧂",
    children: [
      { slug: "faina-malai", label: "Făină și mălai", match: ["faina", "malai", "gris", "cacao", "amidon", "budinca praf"], avoid: [] },
      { slug: "paste-fainoase", label: "Paste făinoase", match: ["paste", "spaghete", "macaroane", "tagliatelle", "fidea", "taitei", "lasagna", "penne", "fusilli", "spaghetti"], avoid: ["dinti", "sos"] },
      { slug: "orez-cereale", label: "Orez și cereale", match: ["orez", "arpacas", "bulgur", "cuscus", "quinoa", "linte", "naut", "fasole boabe", "mazare uscata", "fasole"], avoid: ["lapte de orez", "vafe"] },
      { slug: "ulei-otet", label: "Ulei și oțet", match: ["ulei", "otet", "untdelemn"], avoid: ["motor", "corp", "par", "masaj", "esential", "peste"] },
      { slug: "zahar-miere", label: "Zahăr și miere", match: ["zahar", "miere", "indulcitor", "sirop de artar", "unt de arahide", "crema de ciocolata", "tahini"], avoid: [] },
      { slug: "sare-condimente", label: "Sare și condimente", match: ["sare", "piper", "boia", "paprica", "condiment", "cimbru", "oregano", "scortisoara", "vanilie", "praf de copt", "bicarbonat", "drojdie", "coriandru", "curry", "susan", "seminte de"], avoid: ["baie"] },
      { slug: "conserve-borcane", label: "Conserve și borcane", match: ["conserva", "bulion", "pasta de tomate", "compot", "gem", "dulceata", "borcan", "supa", "piure"], avoid: ["ton", "pate", "sardine", "macrou", "chiftelute"] },
      { slug: "sosuri-maioneze", label: "Sosuri și maioneze", match: ["sos", "maioneza", "ketchup", "mustar", "hrean", "dressing"], avoid: [] },
      { slug: "mic-dejun-cereale", label: "Micul dejun și cereale", match: ["cereale", "musli", "fulgi de", "granola", "batoane de cereale", "corn flakes"], avoid: [] },
    ],
  },
  {
    slug: "dulciuri-snacks", label: "Dulciuri și snacks", icon: "🍫",
    children: [
      { slug: "ciocolata", label: "Ciocolată", match: ["ciocolata", "tableta de", "praline"], avoid: [] },
      { slug: "biscuiti-napolitane", label: "Biscuiți și napolitane", match: ["biscuiti", "napolitane", "fursec", "cookie", "wafer"], avoid: ["pesmet"] },
      { slug: "bomboane", label: "Bomboane", match: ["bomboane", "jeleuri", "acadea", "caramele", "guma de mestecat", "drajeuri", "baton"], avoid: [] },
      { slug: "chipsuri-snacks", label: "Chipsuri și snacks sărate", match: ["chips", "snacks", "sticksuri", "covrigei", "popcorn", "crackers"], avoid: [] },
      { slug: "alune-seminte", label: "Alune și semințe", match: ["alune", "seminte", "arahide prajite", "fistic"], avoid: ["ulei", "unt"] },
      { slug: "deserturi-prajituri", label: "Deserturi și prăjituri", match: ["desert", "budinca", "crema de zahar", "tiramisu", "cheesecake"], avoid: [] },
    ],
  },
  {
    slug: "bauturi", label: "Băuturi", icon: "🥤",
    children: [
      { slug: "apa", label: "Apă", match: ["apa minerala", "apa plata", "apa carbogazoasa", "apa de izvor"], avoid: ["gura", "colonie", "parfum", "toaleta", "termala", "micelara"] },
      { slug: "sucuri-nectaruri", label: "Sucuri și nectaruri", match: ["suc", "nectar", "limonada"], avoid: [] },
      { slug: "bauturi-carbogazoase", label: "Băuturi carbogazoase", match: ["cola", "pepsi", "fanta", "sprite", "schweppes", "tonic", "bautura carbogazoasa"], avoid: [] },
      { slug: "cafea", label: "Cafea", match: ["cafea", "espresso", "cappuccino"], avoid: ["lapte pentru cafea", "filtru hartie", "aparat"] },
      { slug: "ceai", label: "Ceai", match: ["ceai", "infuzie"], avoid: [] },
      { slug: "energizante", label: "Băuturi energizante", match: ["energizant", "red bull", "monster", "hell", "isotonic"], avoid: [] },
      { slug: "siropuri", label: "Siropuri", match: ["sirop"], avoid: ["tuse", "artar"] },
      // 492 grocery-section products are beer. The proposal's tree had no home for them, so
      // every one landed unassigned — the single largest gap in the first run.
      { slug: "bere-cidru", label: "Bere și cidru", match: ["bere", "cidru", "blonda", "bruna", "nefiltrata", "lager", "ipa"], avoid: [] },
      { slug: "bauturi-diverse", label: "Alte băuturi", match: ["bautura", "smoothie", "kombucha", "necarbogazoasa", "racoritoare"], avoid: [] },
    ],
  },
  {
    slug: "congelate", label: "Congelate", icon: "🧊",
    children: [
      { slug: "legume-congelate", label: "Legume congelate", match: ["legume congelate", "mazare congelata", "spanac congelat", "amestec de legume"], avoid: [] },
      // THE RULE WAS THE BARE WORD "congelat", i.e. anything frozen at all, so this leaf held
      // frozen broccoli, cherries and breaded cheese under a label promising meat and fish.
      // A single word cannot express "frozen AND meat", but a PHRASE can, and the assigner
      // already scores multi-word matches higher precisely because they are unambiguous.
      // Anything frozen that is not meat or fish now falls to its department's Altele or stays
      // honestly unassigned, rather than being renamed into this leaf.
      {
        slug: "carne-peste-congelate", label: "Carne și pește congelate",
        match: [
          "carne congelata", "peste congelat", "pui congelat", "porc congelat", "vita congelata",
          "somon congelat", "file congelat", "creveti", "calamar", "fructe de mare congelate",
          "mici congelati", "chiftele congelate", "snitel congelat", "burger congelat",
          "fish fingers", "peste pane", "crispy strips",
        ],
        avoid: ["legume", "cartofi", "pizza", "inghetata", "cascaval", "branza", "visine", "capsuni", "fructe de padure"],
      },
      { slug: "pizza-preparate", label: "Pizza și preparate", match: ["pizza", "lasagna congelata", "preparat congelat"], avoid: [] },
      { slug: "inghetata", label: "Înghețată", match: ["inghetata"], avoid: [] },
      { slug: "cartofi-congelati", label: "Cartofi congelați", match: ["cartofi pai", "cartofi congelati", "cartofi prajiti", "wedges"], avoid: [] },
    ],
  },
  {
    slug: "bebelusi", label: "Bebeluși", icon: "🍼",
    // ONE LEAF, DELIBERATELY. Four leaves held 66 products between them and two held nothing at
    // all: no merchant we scrape carries baby food or formula in any volume, so the sub-shelves
    // were a taxonomy we could describe but not fill. Three clicks that lead to an empty page
    // teach a shopper the sidebar is broken faster than a missing category does.
    //
    // The department stays — baby products are a real aisle and the day a merchant carries them
    // this splits again. Until then the rules are merged rather than deleted, so nothing that
    // used to be found stops being found.
    children: [
      {
        slug: "bebelusi-toate", label: "Tot pentru bebeluși",
        match: [
          "scutece", "pampers", "chilotei",
          "formula de lapte", "lapte bebe", "lapte praf bebe",
          "piure bebe", "mancare bebelusi", "gustare bebe", "biscuiti bebe",
          "servetele bebe", "crema bebe", "sampon bebe",
        ],
        avoid: ["adulti", "adult", "incontinenta", "seni", "tena", "baton", "cacao"],
      },
    ],
  },
  {
    // Not in the proposal, and the catalog plainly has it: Auchan and Metro both shelve pet food
    // in the food store. Leaving it out sent every one of these to "unassigned".
    slug: "animale", label: "Animale de companie", icon: "🐾",
    children: [
      { slug: "hrana-animale", label: "Hrană pentru animale", match: ["hrana", "hrana uscata", "pisici", "caini", "catei", "acvariu", "asternut"], avoid: [] },
    ],
  },
  {
    slug: "curatenie-igiena", label: "Curățenie și igienă", icon: "🧼",
    children: [
      { slug: "detergent-rufe", label: "Detergent de rufe", match: ["detergent rufe", "detergent de rufe", "detergent automat", "capsule rufe", "rufe", "detergent"], avoid: ["vase", "geam", "pardoseli"] },
      { slug: "balsam-rufe", label: "Balsam de rufe", match: ["balsam de rufe", "balsam rufe"], avoid: [] },
      { slug: "detergent-vase", label: "Detergent de vase", match: ["detergent de vase", "vase", "tablete masina de spalat vase"], avoid: [] },
      { slug: "curatenie-casa", label: "Curățenie casă", match: ["solutie", "anticalcar", "dezinfectant", "inalbitor", "clor", "pardoseli", "geamuri", "mobila", "aragaz", "universal", "degresant", "wc", "baie"], avoid: [] },
      // Household hardware sold beside the cleaning products: brushes, mops, cloths, buckets.
      { slug: "ustensile-menaj", label: "Ustensile de menaj", match: ["perie", "matura", "faras", "lavete", "burete", "galeata", "mop", "manusi", "carpa", "storcator", "lighean", "covoras", "plastic", "bucatarie", "cos de rufe", "umeras", "sfoara"], avoid: ["maturat", "dinti", "par"] },
      { slug: "hartie-servetele", label: "Hârtie igienică și șervețele", match: ["hartie igienica", "servetele", "prosoape de bucatarie", "servetele umede", "prosop", "prosoape", "hartie", "straturi"], avoid: [] },
      { slug: "igiena-personala", label: "Igienă personală", match: ["sampon", "gel de dus", "sapun", "deodorant", "pasta de dinti", "periuta de dinti", "apa de gura", "aparat de ras", "spuma de ras", "absorbante", "tampoane", "crema de fata", "crema de corp", "crema de maini", "lotiune", "balsam de par", "vopsea", "fixativ", "gel de par", "parfum", "unghii", "demachiant", "antiperspirant", "ras", "dus", "corp", "periuta", "aftershave", "masca de par", "crema de par", "balsam de par", "spray de par", "crema hidratanta", "incontinenta", "scutece adulti"], avoid: ["rufe", "vase", "branza", "smantana", "ciocolata", "zahar"] },
      { slug: "saci-pungi", label: "Saci și pungi menaj", match: ["saci menaj", "pungi", "folie alimentara", "hartie de copt", "saci gunoi", "gunoi", "saci"], avoid: [] },
      { slug: "insecticide-odorizante", label: "Insecticide și odorizante", match: ["insecticid", "odorizant", "anti insecte", "capcana"], avoid: [] },
    ],
  },
];

/**
 * EVERY DEPARTMENT NEEDS SOMEWHERE FOR "THIS DEPARTMENT, BUT NO PARTICULAR SHELF" TO GO.
 *
 * Without one, a merchant that files a product under its DEPARTMENT ("Lactate si oua",
 * "Produse congelate") had its path scored as if it were a product name, and it landed on
 * whichever leaf's word happened to appear in the department's own title. "lactate si oua"
 * matched the word `oua` at index 2 and scored 0.82, so 1,047 pieces of feta, mascarpone and
 * urda were filed under EGGS. "produse congelate" matched `congelat` and put frozen broccoli
 * under frozen meat. Both leaves became their department's catch-all while still claiming, in
 * the sidebar, to be about eggs and about meat.
 *
 * The answer is not a tighter rule on those two leaves — the products have to go somewhere, and
 * a department-level fact is genuinely all the merchant told us. So the catch-all is explicit
 * and honestly labelled: a shopper reads "Altele" as the rest of the department, which is what
 * it is, rather than as a category that lied about its contents.
 *
 * `match: []` on purpose — NO product name can ever score into one of these. They are reachable
 * only from `assignByMerchantPath`, when the merchant named a department and nothing deeper.
 */
export const CATCH_ALL_SUFFIX = "-altele";
export function catchAllSlugFor(departmentSlug: string): string {
  return `${departmentSlug}${CATCH_ALL_SUFFIX}`;
}
export function isCatchAll(leafSlug: string): boolean {
  return leafSlug.endsWith(CATCH_ALL_SUFFIX);
}

for (const d of GROCERY_TREE) {
  d.children.push({ slug: catchAllSlugFor(d.slug), label: `Altele — ${d.label}`, match: [], avoid: [] });
}

export const ALL_LEAVES: (Leaf & { department: string })[] = GROCERY_TREE.flatMap((d) =>
  d.children.map((c) => ({ ...c, department: d.slug })),
);

export function leafCount(): number { return ALL_LEAVES.length; }
export function departmentCount(): number { return GROCERY_TREE.length; }
