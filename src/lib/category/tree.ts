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
      { slug: "carne-peste-congelate", label: "Carne și pește congelate", match: ["congelat", "congelate"], avoid: ["legume", "cartofi", "pizza", "inghetata"] },
      { slug: "pizza-preparate", label: "Pizza și preparate", match: ["pizza", "lasagna congelata", "preparat congelat"], avoid: [] },
      { slug: "inghetata", label: "Înghețată", match: ["inghetata"], avoid: [] },
      { slug: "cartofi-congelati", label: "Cartofi congelați", match: ["cartofi pai", "cartofi congelati", "cartofi prajiti", "wedges"], avoid: [] },
    ],
  },
  {
    slug: "bebelusi", label: "Bebeluși", icon: "🍼",
    children: [
      { slug: "lapte-praf", label: "Lapte praf și formule", match: ["formula de lapte", "lapte bebe", "lapte praf bebe"], avoid: ["baton", "cacao", "adulti"] },
      { slug: "mancare-bebe", label: "Mâncare pentru bebeluși", match: ["piure bebe", "mancare bebelusi", "gustare bebe", "biscuiti bebe"], avoid: [] },
      { slug: "scutece", label: "Scutece", match: ["scutece", "pampers", "chilotei"], avoid: ["adulti", "adult", "incontinenta", "seni", "tena"] },
      { slug: "ingrijire-bebe", label: "Îngrijire bebeluși", match: ["servetele bebe", "crema bebe", "sampon bebe"], avoid: [] },
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
      { slug: "ustensile-menaj", label: "Ustensile de menaj", match: ["perie", "matura", "faras", "lavete", "burete", "galeata", "mop", "manusi", "carpa", "storcator", "lighean", "covoras", "plastic", "bucatarie", "cos de rufe", "umeras", "sfoara"], avoid: ["dinti", "par"] },
      { slug: "hartie-servetele", label: "Hârtie igienică și șervețele", match: ["hartie igienica", "servetele", "prosoape de bucatarie", "servetele umede", "prosop", "prosoape", "hartie", "straturi"], avoid: [] },
      { slug: "igiena-personala", label: "Igienă personală", match: ["sampon", "gel de dus", "sapun", "deodorant", "pasta de dinti", "periuta de dinti", "apa de gura", "aparat de ras", "spuma de ras", "absorbante", "tampoane", "crema de fata", "crema de corp", "crema de maini", "lotiune", "balsam de par", "vopsea", "fixativ", "gel de par", "parfum", "unghii", "demachiant", "antiperspirant", "ras", "dus", "corp", "periuta", "aftershave", "masca de par", "crema de par", "balsam de par", "spray de par", "crema hidratanta", "incontinenta", "scutece adulti"], avoid: ["rufe", "vase", "branza", "smantana", "ciocolata", "zahar"] },
      { slug: "saci-pungi", label: "Saci și pungi menaj", match: ["saci menaj", "pungi", "folie alimentara", "hartie de copt", "saci gunoi", "gunoi", "saci"], avoid: [] },
      { slug: "insecticide-odorizante", label: "Insecticide și odorizante", match: ["insecticid", "odorizant", "anti insecte", "capcana"], avoid: [] },
    ],
  },
];

export const ALL_LEAVES: (Leaf & { department: string })[] = GROCERY_TREE.flatMap((d) =>
  d.children.map((c) => ({ ...c, department: d.slug })),
);

export function leafCount(): number { return ALL_LEAVES.length; }
export function departmentCount(): number { return GROCERY_TREE.length; }
