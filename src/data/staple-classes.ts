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

  // ══ BATCH 2 ═════════════════════════════════════════════════════════════════════════════

  // ══ RICE — basmati is a distinct, specifically-shopped-for variety (same reasoning as the
  //    existing per-apple-variety classes), not a footnote of the generic `orez-bob-lung-1kg`
  //    class. Jasmine and arborio/risotto rice are real too but too thin in this batch's
  //    reading to be worth a class yet — left for a later pass rather than forced in.
  pack("orez-basmati-1kg", "Orez basmati, 1 kg", "kg", 1,
    ["orez", "basmati"],
    ["jasmine", "arborio", "risotto", "lapte", "pilaf"]),
  pack("orez-basmati-500g", "Orez basmati, 500 g", "kg", 0.5,
    ["orez", "basmati"],
    ["jasmine", "arborio", "risotto", "lapte", "pilaf"]),

  // ══ TOAST BREAD — packaged, shelf-stable, branded (Vel Pitar / Auchan / KB / Schar), not the
  //    fresh bakery counter — so this does not carry the UHT-vs-fresh ambiguity that kept milk
  //    out of private-label-classes.ts. White and wholegrain are split, same reasoning as flour
  //    000 vs 650: different bake, different price, and the catalog states which is which.
  pack("paine-toast-alba-600g", "Pâine toast albă, 600 g", "kg", 0.6,
    ["paine", "toast"],
    ["integral", "graham", "secara", "gluten", "proteine", "hipoglucidic", "ultrafibre", "neagra"]),
  pack("paine-toast-integral-600g", "Pâine toast integrală, 600 g", "kg", 0.6,
    ["paine", "toast", "integral"],
    ["gluten", "hipoglucidic", "ultrafibre"]),

  // ══ CAȘCAVAL — sliced only, plain. "afumat" (smoked), "light" and "pane"/"congelat" (breaded,
  //    frozen sticks — a completely different prepared food) are real, priced-differently
  //    variants; "Pringles Cașcaval & Ceapă" is a crisps flavour, not cheese, and is named out
  //    explicitly rather than trusted to the size window.
  pack("cascaval-felii-250g", "Cașcaval felii, 250 g", "kg", 0.25,
    ["cascaval", "felii|feliat"],
    ["afumat", "light", "pane", "congelat", "pringles", "ceapa"]),

  // ══ MĂLAI — sibling of the existing `malai-1kg` at the other common pack size. Whole-grain is
  //    named out, same reasoning as flour and oats elsewhere in this file.
  pack("malai-500g", "Mălai, 500 g", "kg", 0.5,
    ["malai"],
    ["integral"]),

  // ══ YOGHURT — the SAME require/exclude as the already-live `iaurt-natural-400g` /
  //    `iaurt-grecesc-400g` classes, at the two other sizes this catalog actually sells them in
  //    (150 g single pots, 900 g tubs). Deliberately not a new judgement call: "natural"/
  //    "grecesc" in a Romanian product name already implies plain, which is why the existing
  //    400 g classes don't additionally exclude every flavour by name and this doesn't either —
  //    consistency with a rule already proven, not a fresh one.
  //
  //    `iaurt` added to EVERY one of these `require` arrays (also backported to the 400 g
  //    originals) after "Vilgain Humus natural 140 g" — chickpea dip — qualified for
  //    `iaurt-natural-400g` on the word "natural" alone, once the brand-aware lead-token fix let
  //    it reach the membership check. "natural"/"grecesc" being registered as alternate leads
  //    (they're in `require`) means the lead check alone could never catch this.
  pack("iaurt-natural-150g", "Iaurt natural, 150 g", "kg", 0.15,
    ["iaurt", "natural"],
    ["bautura", "inghetata", "chec", "grecesc", "fructe"]),
  pack("iaurt-grecesc-150g", "Iaurt grecesc, 150 g", "kg", 0.15,
    ["iaurt", "grecesc"],
    ["bautura", "inghetata", "chec"]),
  pack("iaurt-natural-900g", "Iaurt natural, 900 g", "kg", 0.9,
    ["iaurt", "natural"],
    ["bautura", "inghetata", "chec", "grecesc", "fructe"]),
  pack("iaurt-grecesc-900g", "Iaurt grecesc, 900 g", "kg", 0.9,
    ["iaurt", "grecesc"],
    ["bautura", "inghetata", "chec"]),

  // ══ BATCH 4 ═════════════════════════════════════════════════════════════════════════════

  // ══ TEA — split by type, same reasoning as the existing `ceai-fructe-20` class. Sachet-box
  //    weight varies a lot by brand (20×1g to 20×2g to 80×1.3g), so this uses an explicit wide
  //    window rather than `pack()`'s tight default — the discriminator here is the TYPE word,
  //    not the weight, and the window only needs to keep loose-leaf tins and huge catering
  //    boxes out, not pin an exact sachet count.
  { slug: "ceai-musetel-20", label: "Ceai de mușețel, cutie", unit: "kg", unitSize: 0.03,
    attributes: { tip: "musetel", strictRules: true, minUnitSize: 0.015, maxUnitSize: 0.045, require: ["ceai", "musetel"], exclude: ["fructe", "menta", "verde", "negru", "tei"] } },
  { slug: "ceai-menta-20", label: "Ceai de mentă, cutie", unit: "kg", unitSize: 0.03,
    attributes: { tip: "menta", strictRules: true, minUnitSize: 0.015, maxUnitSize: 0.045, require: ["ceai", "menta"], exclude: ["fructe", "musetel", "verde", "negru", "tei"] } },

  // ══ APPLE JUICE — sibling of the existing `suc-portocale-1l`, same exclude shape (keep out
  //    mixed-fruit blends, nectar, carbonated, concentrate).
  pack("suc-mere-1l", "Suc de mere, 1 L", "l", 1,
    ["mere", "suc"],
    ["nectar", "bautura", "carbogazoas", "concentrat", "sirop", "afine", "catina", "morcov", "piersic", "pere", "struguri", "rodie", "aronia", "mixt"]),

  // ══ RYE FLOUR — a different grain, not a form of the same flour the way 000 and 650 wheat
  //    grades are. `faina-alba-1kg` / `faina-alba-650-1kg` already own the wheat grades.
  pack("faina-secara-1kg", "Făină de secară, 1 kg", "kg", 1,
    ["faina", "secara"],
    []),

  // ══ OLIVES — black vs green is the real, price-driving split (the catalog prices them the
  //    same within colour and differently across it), same reasoning as apple variety. Brine vs
  //    oil is NOT split here — both are "black pitted olives" for a shopper's purposes, unlike
  //    colour, and splitting every packing liquid would mostly produce single-shop classes.
  // "umplute" (stuffed — jalapeño, almonds, salmon paste) added after the dry run showed several
  // genuinely gourmet stuffed-olive jars qualifying: a real, differently-priced product, not
  // plain pitted olives.
  pack("masline-negre-350g", "Măsline negre, 350 g", "kg", 0.35,
    ["masline", "negre"],
    ["verzi", "umplute"], 0.15),
  pack("masline-verzi-350g", "Măsline verzi, 350 g", "kg", 0.35,
    ["masline", "verzi"],
    ["negre", "umplute"], 0.15),

  // ══ HONEY — polyfloral only; monofloral types (salcâm/tei/cătină) are a real, priced-
  //    differently variety split, same as apple variety, and are left for a later batch rather
  //    than merged in.
  //
  //    Measured EMPTY at first: every "Miere Poliflora" product in this catalog leads with a
  //    TWO-WORD brand ("Fine Life", "METRO Chef", "RIOBA"), which pushed both "miere" and
  //    "poliflora" past the proposer's first-two-token lead check — the telemea problem
  //    (CLAUDE.md) in a harder form a single alternate head could not fix. Fixed properly at
  //    the source rather than loosened here: `propose-equivalence.ts`'s lead check is now
  //    brand-aware (strips the product's own `brand` field before taking the lead two tokens),
  //    which is also how this exposed real exclude-list gaps in ~15 OTHER, older classes — see
  //    their own updated comments (cartofi-albi-kg, salata-verde-kg, carne-porc-1kg, etc.).
  pack("miere-poliflora-500g", "Miere poliflora, 500 g", "kg", 0.5,
    ["miere", "poliflora"],
    ["salcam", "tei", "catina", "manuca", "turmeric", "stick", "portionat"]),

  // ══ APPLE CIDER VINEGAR — a distinct product from the existing `otet-alcool-1l`, not a size
  //    sibling of it.
  pack("otet-mere-500ml", "Oțet de mere, 500 ml", "l", 0.5,
    ["otet", "mere"],
    ["balsamic", "alcool"]),

  // ══ EGGS — siblings of the existing `oua-l-10` / `oua-m-10` at the other common pack counts.
  //    Quail eggs ("prepelita") are already excluded by the base rule this mirrors.
  { slug: "oua-l-20", label: "Ouă mărimea L, 20 buc", unit: "buc", unitSize: 20, attributes: { size: "L", require: ["l|marimea l|marime l"], exclude: ["m/l|prepelita|ciocolata"] } },
  { slug: "oua-m-20", label: "Ouă mărimea M, 20 buc", unit: "buc", unitSize: 20, attributes: { size: "M", require: ["m|marimea m|marime m"], exclude: ["m l|prepelita|ciocolata"] } },
  { slug: "oua-m-30", label: "Ouă mărimea M, 30 buc", unit: "buc", unitSize: 30, attributes: { size: "M", require: ["m|marimea m|marime m"], exclude: ["m l|prepelita|ciocolata"] } },

  // ══ CREAM — two DIFFERENT products sharing one head noun, and the existing `smantana-200g`
  //    (soured/table cream) already excludes "gatit" to keep this one out, rather than merging
  //    them. Coconut cream is a distinct product, not a dairy-cream variant.
  pack("smantana-gatit-200ml", "Smântână pentru gătit, 200 ml", "l", 0.2,
    ["smantana", "gatit"],
    ["cocos"]),
  // Sibling of `smantana-200g` at the other dominant card size (370-375 g across three brands).
  pack("smantana-370g", "Smântână, 370 g", "kg", 0.37,
    ["smantana"],
    ["branza", "crema", "almette", "gatit"]),

  // ══ BATCH 6 ═════════════════════════════════════════════════════════════════════════════

  // ══ TELEMEA — siblings of the existing `branza-telemea-400g` at the other common sizes. Does
  //    NOT split by species (vacă/capră/oaie), matching that class's own established behaviour —
  //    not a new judgement call.
  pack("telemea-200g", "Brânză telemea, 200 g", "kg", 0.2,
    ["telemea"],
    ["burduf", "topita", "cheddar", "mozzarella"]),
  pack("telemea-1kg", "Brânză telemea, 1 kg", "kg", 1,
    ["telemea"],
    ["burduf", "topita", "cheddar", "mozzarella"]),

  // ══ MOZZARELLA — plain solid/log form only. Mini balls ("bilute"/"rulouri"/"ciliegine"),
  //    sliced and grated are different uses at different prices, same reasoning as cascaval.
  pack("mozzarella-125g", "Mozzarella, 125 g", "kg", 0.125,
    ["mozzarella"],
    ["rasa", "felii", "feliata", "mini", "rulouri", "bilute", "ciliegine", "fresca mini"]),

  // ══ TUNA — olive-oil-packed only, single can. Own-juice and sunflower-oil-packed are real,
  //    differently-priced forms left for a later pass, not merged in.
  pack("ton-ulei-masline-160g", "Ton în ulei de măsline, 160 g", "kg", 0.16,
    ["ton", "ulei", "masline"],
    ["floarea soarelui", "iute"]),

  // ══ HAM — Praga-style (boiled, sliced) only. Serrano is a completely different cured product
  //    at a different price; turkey/chicken ham are a different meat, not a form of this one.
  pack("sunca-praga-100g", "Șuncă Praga, 100 g", "kg", 0.1,
    ["sunca", "praga"],
    ["serrano", "curcan", "pui"]),
  pack("sunca-praga-200g", "Șuncă Praga, 200 g", "kg", 0.2,
    ["sunca", "praga"],
    ["serrano", "curcan", "pui"]),

  // ══ CORN FLAKES — sibling of the existing `fulgi-ovaz-500g` (oats), for the other common
  //    flake grain in this catalog. "fara zahar" (no added sugar) is a real member, not
  //    excluded — only the grain is the discriminator here.
  pack("fulgi-porumb-500g", "Fulgi de porumb, 500 g", "kg", 0.5,
    ["fulgi", "porumb"],
    []),

  // ══ BATCH 7 ═════════════════════════════════════════════════════════════════════════════

  // ══ SEEDS — chia and pumpkin are distinct, specifically-shopped-for seed types at their own
  //    price point, not a footnote of the existing sunflower-seed classes.
  pack("seminte-chia-200g", "Semințe de chia, 200 g", "kg", 0.2,
    ["seminte", "chia"],
    []),
  pack("seminte-dovleac-150g", "Semințe de dovleac, 150 g", "kg", 0.15,
    ["seminte", "dovleac"],
    []),

  // ══ PEANUTS — siblings of the existing `arahide-coaja-500g`/`arahide-decojite-500g` at a
  //    smaller, very common pack size. Raw (never roasted), honey-coated and chocolate-coated
  //    are real, differently-priced forms and stay out.
  pack("arahide-sarate-300g", "Arahide sărate, 300 g", "kg", 0.3,
    ["arahide"],
    ["cruda", "crude", "miere", "ciocolata", "in coaja"]),

  // ══ BATCH 8 — CHOCOLATE, the deliberately-deferred category, done carefully ═══════════════
  //
  // `kg::ciocolata` is 423 products and overwhelmingly filled/flavoured (caramel, pistachio,
  // hazelnut, raisin, biscuit, raspberry, almond, yoghurt, rum, orange, Oreo, cheesecake...). A
  // plain milk/dark bar sitting one word away from a filled one is exactly the shape of false
  // match this project keeps finding, so this exclude list is long on purpose, built by reading
  // every member this script's dry run actually proposes (not guessed from the 60-row sample
  // `cluster:report` prints) — see the workflow note in `propose:equivalence`'s own dry-run
  // step, which this class went through twice before being applied.
  // Both lists below were tightened against the FULL candidate set the dry run actually
  // proposed (not the 60-row cluster sample) — `fine-life caju`, `klc ciocolata lapte
  // noisette` (noisette = hazelnut, French) and `mousse de lapte` only surfaced that way.
  pack("ciocolata-lapte-90g", "Ciocolată cu lapte, 90 g", "kg", 0.09,
    ["ciocolata", "lapte"],
    ["caramel", "fistic", "kadayif", "arahide", "alune", "stafide", "biscuiti", "zmeura",
     "migdale", "iaurt", "cappuccino", "triolade", "cocos", "quinoa", "portocal", "oreo",
     "cheesecake", "rom", "vanilie", "capsuni", "visine", "menaj", "alba", "bubbly", "milkinis",
     "cows", "crema", "umplutura", "interior", "biscoff", "dubai", "cards", "merci",
     "caju", "mousse", "orez", "noisette", "menta", "amarena", "m m", "glazura", "bomboane",
     "batoane", "toblerone", "vegana", "mix"], 0.15),
  pack("ciocolata-neagra-85g", "Ciocolată neagră, 85 g", "kg", 0.085,
    ["ciocolata", "neagra|amaruie"],
    ["caramel", "fistic", "kadayif", "arahide", "alune", "stafide", "biscuiti", "zmeura",
     "migdale", "iaurt", "cappuccino", "rom", "vanilie", "capsuni", "visine", "menaj", "crema",
     "umplutura", "interior", "orange", "raspberry", "portocal",
     "cafea", "mango", "banana", "bucatele", "afine", "lime", "ghimbir", "menta"], 0.15),

  // ══ BATCH 9 — BISCUITS, two narrow safe sub-types out of a 521-product, mostly-filled
  //    cluster (sandwich cookies, savory crackers, granola bars). These two are genuinely
  //    plain-by-definition product TYPES, not a guess at where the flavour line falls:
  //    "Petit Beurre" names a standardised plain butter biscuit, and nothing calling itself
  //    that in this catalog carries a filling. "Digestiv" is likewise a plain, filling-free
  //    category name. Verified with `verify:class` before applying, same as chocolate.
  pack("biscuiti-petit-beurre-100g", "Biscuiți Petit Beurre, 100 g", "kg", 0.1,
    ["petit", "beurre"],
    [], 0.2),
  pack("biscuiti-digestivi-400g", "Biscuiți digestivi, 400 g", "kg", 0.4,
    ["digestiv"],
    ["musli", "fulgi de ciocolata"], 0.2),

  // ══ BATCH 10 — PLAIN SALTED CRISPS, the one safe cut out of `kg::chipsuri` (196 products,
  //    otherwise entirely flavoured: sour cream & onion, cheese, paprika, BBQ, chicken...).
  //    "sare" alone is not enough — "cu smântână, sare și ceapă" would also satisfy a bare
  //    `require: ["sare"]`, so every OTHER flavour word seen in this cluster is named out too.
  //    Verified member-by-member with `verify:class` before applying.
  pack("chipsuri-sare-100g", "Chipsuri cu sare, 100 g", "kg", 0.1,
    ["chipsuri", "sare"],
    ["smantana", "ceapa", "cascaval", "paprika", "paprica", "barbeque", "piper", "iaurt",
     "pui", "marar", "patrunjel", "lime", "otet", "cheddar", "branza", "fara sare", "sfecla", "pastarnac", "batate", "plantan"], 0.15),
  pack("chipsuri-sare-125g", "Chipsuri cu sare, 125 g", "kg", 0.125,
    ["chipsuri", "sare"],
    ["smantana", "ceapa", "cascaval", "paprika", "paprica", "barbeque", "piper", "iaurt",
     "pui", "marar", "patrunjel", "lime", "otet", "cheddar", "branza", "fara sare", "sfecla", "pastarnac", "batate", "plantan"], 0.15),
  pack("chipsuri-sare-170g", "Chipsuri cu sare, 170 g", "kg", 0.17,
    ["chipsuri", "sare"],
    ["smantana", "ceapa", "cascaval", "paprika", "paprica", "barbeque", "piper", "iaurt",
     "pui", "marar", "patrunjel", "lime", "otet", "cheddar", "branza", "fara sare", "sfecla", "pastarnac", "batate", "plantan"], 0.1),

  // ══ BATCH 11 — DEODORANT SPRAY, a DELIBERATELY DIFFERENT judgement call from every food
  //    class above. Scent is not excluded here, and neither is the men's/women's line, on
  //    purpose: unlike a flavour, a fragrance does not change what the product DOES, and a
  //    shopper substituting "Dove Men Clean Comfort" for "Dove Women Fresh Natural" when the
  //    exact one is out of stock is a far smaller leap than chocolate-for-chocolate ever is.
  //    FORM still matters and stays split: requiring "spray" naturally keeps roll-on and stick
  //    out (their names say so), because application method, unlike scent, does change the
  //    product. 150 ml is this catalog's overwhelmingly dominant spray size.
  // `incaltaminte` added after `verify:class` turned up "Deodorant spray pentru interior
  // incaltaminte" — a SHOE freshener, not a personal antiperspirant, sitting right inside the
  // size window at 125 ml.
  pack("deodorant-spray-150ml", "Deodorant spray, 150 ml", "l", 0.15,
    ["deodorant", "spray"],
    ["incaltaminte"], 0.2),

  // ══ BATCH 12 — SHOWER GEL, same scent-tolerant judgement as deodorant spray, carved out of
  //    `l::gel` (348 products) which otherwise mixes it with drain-cleaner and dishwasher-
  //    descaler gel under the same bare head noun "gel" — requiring "dus" (shower) keeps those
  //    out structurally, not by naming every cleaning-chemical product. The 2-in-1 shower-gel-
  //    and-shampoo combo is excluded: it is a different product, not a shower gel with an
  //    extra feature. Wide window: this catalog's real bottle sizes span 400-750 ml.
  pack("gel-de-dus-550ml", "Gel de duș, 550 ml", "l", 0.55,
    ["gel", "dus"],
    ["sampon"], 0.45),

  // ══ BATCH 13 — more scent-tolerant personal care, same judgement as deodorant/shower gel.
  //    Liquid hand soap: "antibacterian" is kept OUT, since that is a real functional claim
  //    (an added active ingredient), not a fragrance — the same distinction that kept deodorant
  //    FORM split while leaving its scent alone.
  // `intim`/`antiseptic`/`spuma` added after `verify:class`: intimate wash is a different
  // product category, antiseptic is a functional claim like antibacterial, and foaming soap is
  // a different dispensing format (the same "form, not scent" line drawn for deodorant).
  pack("sapun-lichid-500ml", "Săpun lichid, 500 ml", "l", 0.5,
    ["sapun", "lichid"],
    ["antibacterian", "sanytol", "intim", "antiseptic", "spuma"], 0.5),

  // Body lotion only — "lotiune" alone also covers sunscreen, after-shave and micellar
  // cleansing lotion, which are different products, not a scent of this one. Requiring "corp"
  // (body) excludes all of those structurally, the same way "dus" did for shower gel.
  pack("lotiune-corp-400ml", "Loțiune de corp, 400 ml", "l", 0.4,
    ["lotiune", "corp"],
    [], 0.25),

  // ══ BATCH 14 — DISH SOAP PASTE, same scent-tolerant judgement again. "pasta" (paste form,
  // vs. liquid) is required so this stays its own product, not a size sibling of a liquid
  // dish soap class.
  pack("detergent-vase-pasta-225g", "Detergent de vase, pastă, 225 g", "kg", 0.225,
    ["detergent", "vase", "pasta"],
    [], 0.25),
  pack("detergent-vase-pasta-400g", "Detergent de vase, pastă, 400 g", "kg", 0.4,
    ["detergent", "vase", "pasta"],
    [], 0.2),

  // ══ BATCH 15 — AIR FRESHENER, same scent-tolerant judgement. Room spray and solid toilet
  // blocks are naturally two different units already (l vs kg), so they don't need an explicit
  // exclude to stay apart - requiring "camera" vs "toaleta" is what actually separates them.
  pack("odorizant-camera-120ml", "Odorizant de cameră, 120 ml", "l", 0.12,
    ["odorizant", "camera"],
    [], 0.15),
  pack("odorizant-camera-150ml", "Odorizant de cameră, 150 ml", "l", 0.15,
    ["odorizant", "camera"],
    [], 0.15),
  pack("odorizant-toaleta-50g", "Odorizant pentru toaletă, 50 g", "kg", 0.05,
    ["odorizant", "toaleta"],
    [], 0.2),

  // ══ BATCH 16 ═══════════════════════════════════════════════════════════════════════════
  pack("branza-vaci-proaspata-200g", "Brânză de vaci proaspătă, 200 g", "kg", 0.2,
    ["branza", "vaci", "proaspata"],
    ["smantana", "light", "usoara"], 0.3),
  // `trufe`/`mistret`/`masline`/`ardei`/`ceapa` added after `verify:class`: truffles, wild
  // boar, olives, peppers and onion are all real recipe flavours sitting right inside this
  // window, not a plain pork pâté.
  pack("pate-porc-100g", "Pate de porc, 100 g", "kg", 0.1,
    ["pate", "porc"],
    ["ficat", "unt", "ton", "picant", "trufe", "mistret", "masline", "ardei", "ceapa"], 0.25),
  pack("ulei-susan-125ml", "Ulei de susan, 125 ml", "l", 0.125,
    ["ulei", "susan"],
    [], 0.3),
  pack("zahar-vanilinat-8g", "Zahăr vanilinat, 8 g", "kg", 0.008,
    ["zahar", "vanilinat|vanilat"],
    [], 0.3),

  // ══ BATCH 17 — COFFEE CAPSULES, split by MACHINE COMPATIBILITY, not flavour. Unlike every
  // flavour-driven food class above, this discriminator is a hard physical constraint — a
  // Nespresso capsule does not fit a Dolce Gusto machine — so the three systems can never be
  // one class, and flavour WITHIN a system is treated the deodorant-spray way (a preference,
  // not a different product), except decaf, which is a caffeine-content fact, not a flavour.
  pack("cafea-capsule-nespresso-10", "Capsule cafea compatibile Nespresso, 10 buc", "buc", 10,
    ["capsule", "cafea", "nespresso"],
    ["decofeinizat", "decafeinizat", "ciocolata", "kitkat"], 0.2),
  pack("cafea-capsule-dolce-gusto-16", "Capsule cafea compatibile Dolce Gusto, 16 buc", "buc", 16,
    ["capsule", "cafea", "dolce", "gusto"],
    ["decofeinizat", "decafeinizat", "ciocolata", "kitkat"], 0.15),
  pack("cafea-capsule-tassimo-16", "Capsule cafea compatibile Tassimo, 16 buc", "buc", 16,
    ["capsule", "cafea", "tassimo"],
    ["decofeinizat", "decafeinizat", "ciocolata", "kitkat"], 0.15),

  // ══ BATCH 18 ═══════════════════════════════════════════════════════════════════════════
  //
  // Same two concepts as `ceai-musetel-20`/`ceai-menta-20` above, but this merchant counts the
  // box in SACHETS (buc) rather than grams — a different pricing unit, so a genuine sibling
  // class, not a duplicate of the kg one (mixing buc and kg in one class would break lei-per-
  // unit comparison).
  pack("ceai-musetel-buc20", "Ceai de mușețel, 20 plicuri", "buc", 20,
    ["ceai", "musetel"],
    ["fructe", "menta", "verde", "negru", "tei"], 0.3),
  pack("ceai-menta-buc20", "Ceai de mentă, 20 plicuri", "buc", 20,
    ["ceai", "menta"],
    ["fructe", "musetel", "verde", "negru", "tei"], 0.3),

  // ══ RAZOR — 3-blade disposable only, any pack count (priced per razor either way, the way
  // loose-produce classes price per kg regardless of pack). Blade count is a real, priced-
  // differently spec, same reasoning as olive colour or almond form, so 2-blade/5-blade stay
  // their own (unwritten) classes rather than being merged in by a looser rule.
  { slug: "aparat-ras-3lame", label: "Aparat de ras de unică folosință, 3 lame", unit: "buc", unitSize: 4,
    attributes: { require: ["aparat", "ras", "3 lame"], exclude: ["tantari"], anySize: true, minUnitSize: 1, maxUnitSize: 10 } },

  // ══ TOOTHBRUSH — adult, MEDIUM bristles only, any pack count. Bristle firmness is a real,
  // sometimes medically-relevant spec (soft is often what sensitive gums need), same reasoning
  // as razor blade count, so it is required explicitly rather than left to chance. Kids'
  // brushes and the denture-cleaning brush are a different product, not a size of this one.
  { slug: "periuta-dinti-medie", label: "Periuță de dinți, medie", unit: "buc", unitSize: 2,
    attributes: { require: ["periuta", "dinti", "mediu|medium"], exclude: ["copii", "kids", "ani", "proteze", "interdental", "soft", "moi"], anySize: true, minUnitSize: 1, maxUnitSize: 6 } },

  // ══ BATCH 20 — GLASS CLEANER, scent-tolerant, two real catalog spellings ("spray" vs
  // "solutie" geamuri) kept as two classes rather than forced into one, the same reasoning as
  // the sachet-count vs gram-weight tea classes above.
  pack("spray-geamuri-500ml", "Spray pentru geamuri, 500 ml", "l", 0.5,
    ["spray", "geamuri"],
    [], 0.2),
  pack("solutie-geamuri-500ml", "Soluție pentru geamuri, 500 ml", "l", 0.5,
    ["solutie", "geamuri"],
    [], 0.2),
];
