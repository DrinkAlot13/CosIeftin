// 40 real Romanian grocery search queries, with what each one MUST and MUST NOT return.
//
// Written as the shopper types: no diacritics (a Romanian phone keyboard makes them work),
// misspellings, brand-only queries, category-only queries, and the two-word "product + brand"
// pattern that is by far the most common.
//
// `mustFind` / `mustNotFind` are substrings matched case-insensitively against the returned
// product names, after the same normalisation search itself uses. They describe INTENT, not an
// exact result set: a query for milk must return milk and must not return chocolate milk drink
// mislabelled as milk. Ranking positions are asserted separately, and only where the top hit
// is genuinely unambiguous.
//
// ── THE CASE THAT CHANGED THE DESIGN ────────────────────────────────────────────────────────
// "illy capsule" returned 208 products, none of them illy: Starbucks, Nescafé, Tassimo, L'Or.
// We carry ZERO illy products — verified across every merchant and every state, including
// withheld and stale. The query named a brand and we answered with the category.
//
// So the fixture now carries a class of case it never had: `expectBrandMiss`, a query naming
// something we do not stock. Getting these right is not about ranking. It is about a search
// that can say "we do not have this", which the old one structurally could not: its brand
// filter was built from the brands the catalog HAS, so a brand we lack produced no filter at
// all and fell through to fuzzy scoring. The one case where a shopper most needs a straight
// answer was the one case that could not produce one.

export type SearchCase = {
  q: string;
  /** why this query is in the set — kept so a future failure is legible */
  why: string;
  /** every one of these must appear somewhere in the results */
  mustFind?: string[];
  /** none of these may appear anywhere in the results */
  mustNotFind?: string[];
  /** if set, the FIRST result's name must contain this */
  topMustContain?: string;
  /**
   * None of these may be the FIRST result.
   *
   * Stronger than `mustNotFindInTop` about position and weaker about reach, and it is the right
   * strength for most "wrong kind of product" complaints: a shopper typing "zahar" can live
   * with icing sugar fourth, but not first. Asserting the top five instead made cases fail on
   * catalogs where the near neighbour legitimately belongs in the list.
   */
  topMustNotContain?: string[];
  /**
   * None of these may appear in the TOP 5. Weaker than `mustNotFind`, and the right strength
   * for a near neighbour that legitimately belongs in the long tail: body lotion is a real
   * answer to "lapte" for someone who wants it, but it must not lead.
   */
  mustNotFindInTop?: string[];
  /** if set, the query must return nothing at all */
  expectEmpty?: boolean;
  /**
   * The query names a term we do not carry. Search must report THIS term as missing and
   * present whatever it shows as clearly-labelled alternatives — never as matches.
   */
  expectBrandMiss?: string;
  /** For a brand we DO carry: every result must be that brand. */
  brandRequired?: string;
};

export const SEARCH_CASES: SearchCase[] = [
  // ── 1. Brands we do NOT stock. The reported bug and its family. ──────────────
  {
    // FIXTURE CORRECTION, recorded rather than quietly edited: this case first asserted
    // mustNotFind ["Starbucks","Nescafe","Tassimo"], and that assertion was wrong. Those ARE
    // the right alternatives to offer someone who wanted illy capsules — the brief asks for
    // exactly that ("Iată alternative din aceeași categorie"). What was wrong before was not
    // their presence but their PRESENTATION: they were returned as if they were illy. That is
    // what `expectBrandMiss` pins, and it is the assertion that belongs here.
    q: "illy capsule",
    why: "THE REPORTED BUG. Zero illy products exist in any merchant in any state; 208 coffee capsules presented as results answer a different question than the one asked",
    expectBrandMiss: "illy",
  },
  { q: "illy", why: "the brand alone, with no category word to fall back on — must not silently become 'coffee'", expectBrandMiss: "illy" },
  { q: "yakult", why: "a second brand we genuinely do not carry, so the rule is not fitted to one word", expectBrandMiss: "yakult" },
  { q: "kelloggs corn flakes", why: "unstocked brand plus a category we DO carry — the alternatives are real, the brand claim is not", expectBrandMiss: "kelloggs" },
  { q: "tropicana suc portocale", why: "unstocked brand with two category words; the fallback must still be labelled as alternatives", expectBrandMiss: "tropicana" },

  // ── 2. Brands we DO stock — results must actually be that brand. ─────────────
  { q: "lapte zuzu", why: "the commonest shape of query: product + brand", mustFind: ["Zuzu"], brandRequired: "zuzu" },
  { q: "cafea lavazza", why: "the illy query with a brand we have — this is what the failing one should look like", brandRequired: "lavazza" },
  { q: "ciocolata milka", why: "brand filter must hold on a category with hundreds of competitors", brandRequired: "milka" },
  { q: "iaurt activia", why: "sub-brand of Danone; naming it must not widen to all Danone yoghurt", brandRequired: "activia" },
  { q: "bere ursus", why: "alcohol brand queried from the grocery box", brandRequired: "ursus" },
  { q: "apa dorna", why: "water brand; 'apa' alone matches hundreds of products", brandRequired: "dorna" },
  { q: "paste barilla", why: "brand appears in the name rather than the brand column on many rows", brandRequired: "barilla" },
  { q: "faina baneasa", why: "brand with Romanian diacritics in the catalog (Băneasa) typed without them", brandRequired: "baneasa" },
  {
    // FIXTURE CORRECTION: this case originally asserted that "ulei baneasa" must return Băneasa
    // oil. It cannot — Băneasa makes flour and pasta, and none of its 75 products is an oil. The
    // OLD search returned 75 results led by "Baneasa Malai 1 kg", which is flour: it answered
    // with the brand and silently dropped the word "ulei". Zero results is the correct outcome,
    // and the useful version of zero names the term that failed and offers the brand's range.
    q: "ulei baneasa",
    why: "brand we DO carry, product we do not — must not answer by dropping the word that failed",
    expectBrandMiss: "ulei",
    mustFind: ["Baneasa"],
  },

  // ── 3. The plain staples, typed plainly. ─────────────────────────────────────
  // The BEFORE run put "Lapte de corp Lactovit, 400ml" — a BODY LOTION — at the top of the
  // commonest query on the site, and the old assertion passed it because the name does contain
  // "Lapte". `topMustContain` alone cannot express "milk you drink", so the case now names the
  // specific wrong answer it saw.
  { q: "lapte", why: "the single most common grocery query — drinking milk must outrank milk CHOCOLATE and body LOTION", mustFind: ["Lapte"], topMustContain: "Lapte", mustNotFindInTop: ["Lapte de corp", "Lapte demachiant"] },
  { q: "paine", why: "no diacritics — 'pâine' as everyone types it", mustFind: ["Paine"] },
  { q: "oua", why: "short head noun, no diacritics", mustFind: ["Oua"] },
  { q: "unt", why: "three letters, and a substring of 'MUNTE' — the trap that priced a spread as butter", mustFind: ["Unt"], topMustContain: "Unt" },
  { q: "zahar", why: "staple; must not be dominated by 'zahar vanilat' or sugar-free labels", mustFind: ["Zahar"] },
  { q: "faina", why: "staple; must not be swamped by flavoured or gluten-free flour blends", mustFind: ["Faina"] },
  { q: "apa minerala", why: "two-word category query", mustFind: ["Apa"] },

  // ── 4. The queries named in the brief. ───────────────────────────────────────
  { q: "lapte 3.5", why: "fat percentage as a decimal — the number is the discriminator and must not be dropped", mustFind: ["Lapte"], topMustContain: "Lapte" },
  { q: "oua L", why: "single-letter size grade; 'L' must not be treated as noise or as a litre", mustFind: ["Oua"] },
  { q: "hartie igienica", why: "two-word household category, no diacritics", mustFind: ["Hartie igienica"] },
  { q: "detergent rufe", why: "two-word household category where 'detergent vase' is the near neighbour", mustFind: ["Detergent"], mustNotFind: ["Detergent de vase"] },
  { q: "cafea boabe", why: "category plus form — must not return ground coffee or capsules first", mustFind: ["Cafea"], topMustContain: "afea" },
  { q: "ulei floarea soarelui", why: "three words, the commonest cooking oil, and 'ulei' alone matches cosmetics", mustFind: ["Ulei"] },
  { q: "iaurt grecesc", why: "category plus style; 'grecesc' is the discriminator against plain yoghurt", mustFind: ["Iaurt"] },

  // ── 5. Romanian diacritics, both directions and both Unicode encodings. ──────
  { q: "sunca", why: "typed without diacritics; must find 'șuncă' (U+0219 comma-below)", mustFind: ["unca"] },
  { q: "șuncă", why: "typed WITH correct comma-below diacritics — the index must fold them too", mustFind: ["unca"] },
  { q: "şuncă", why: "the CEDILLA ş (U+015F), which Romanian sites emit constantly; must behave identically to U+0219", mustFind: ["unca"] },
  { q: "branza", why: "no diacritics for 'brânză'", mustFind: ["ranza"] },
  { q: "cârnați", why: "both â and ț, correct encodings", mustFind: ["arnat"] },
  { q: "telina", why: "'țelină' without diacritics", mustFind: ["elina"] },

  // ── 6. Typos. A shopper on a phone mistypes constantly. ──────────────────────
  { q: "lpate", why: "transposition of 'lapte'; plain Levenshtein ranks 'spate' (pork backs) closer", mustFind: ["Lapte"], topMustContain: "Lapte" },
  { q: "iuart", why: "transposition of 'iaurt'", mustFind: ["Iaurt"] },
  { q: "cicolata", why: "dropped letter in 'ciocolata'", mustFind: ["iocolat"] },

  // ── 7. Nothing at all. ───────────────────────────────────────────────────────
  { q: "", why: "empty query must return nothing rather than the whole catalog", expectEmpty: true },
  { q: "   ", why: "whitespace-only query", expectEmpty: true },
  { q: "qwertyuiop", why: "keyboard mash: must return nothing, not a page of fuzzy near-misses", expectEmpty: true },

  // ── 8. THE TWENTY STAPLES, TYPED THE WAY A PERSON BUILDING A WEEKLY SHOP TYPES THEM.
  //
  // Added after somebody actually used the site (docs/GAP2-USER-FLOWS.md). Adding twenty
  // staples to a list of forty queries sounds redundant until you read what they returned:
  // the FIRST suggestion for seven of them was the wrong KIND of product.
  //
  //     branza telemea  ->  a Dr. Oetker CAKE MIX that mentions telemea
  //     zahar           ->  vanilla ICING sugar, 80 g
  //     apa plata       ->  a 250 ml CHILDREN'S bottle
  //     cafea           ->  a kilo of whole BEANS at 99,99
  //     cartofi         ->  ORGANIC potatoes at 16 lei/kg
  //     piept de pui    ->  frozen BREADED "Crispy", 2 kg
  //     ulei ...        ->  a 6 x 1 L CATERING pack
  //
  // THE DIAGNOSIS, from `npm run audit:staple-search` rather than from a guess: they all score
  // IDENTICALLY. Dozens of products reach tier 300 with `name-phrase + coverage 1.00 +
  // head-noun` = 1.600, and the order among them is settled by the tie-breakers — merchant
  // count, then ALPHABETICAL NAME. "Apa plata **Aqua** Carpatica Kids" wins because "Aqua"
  // sorts before "Borsec". Nothing was ranking these; the sort was.
  //
  // The expectations below are written as `mustNotFindInTop` wherever "what a shopper means" is
  // a judgement — a cake mix is never what "branza telemea" means, but which coffee leads is
  // genuinely arguable and is not asserted.
  { q: "branza telemea", why: "a cheese, never a cake mix that merely mentions it", topMustNotContain: ["pandispan"] },
  { q: "zahar", why: "plain sugar leads; icing sugar with vanilla is a different product", topMustNotContain: ["pudra"] },
  { q: "apa plata", why: "still water for a household, not a 250 ml children's bottle", topMustNotContain: ["Kids"] },
  { q: "cartofi", why: "ordinary potatoes lead; organic at triple the price is a choice, not a default", topMustNotContain: ["eco", "dulci"] },
  { q: "piept de pui", why: "chicken breast, not frozen breaded 'Crispy'", topMustNotContain: ["Crispy"] },
  { q: "oua", why: "eggs — three letters, and a substring of many longer words", mustFind: ["Oua"], topMustContain: "Oua" },
  { q: "paine", why: "bread — the loaf must outrank breadcrumbs and toast products", mustFind: ["Paine"] },
  { q: "iaurt", why: "yoghurt — plain yoghurt, not a drink or a dessert built on it", mustFind: ["Iaurt"], topMustContain: "aurt" },
  { q: "faina", why: "flour — plain wheat flour, not a cake mix that contains it", mustFind: ["Faina"], topMustContain: "aina" },
  { q: "orez", why: "rice — the grain, not rice cakes or rice drinks", mustFind: ["Orez"], topMustContain: "rez" },
  { q: "paste", why: "pasta — dry pasta, and a word that also means toothpaste in Romanian", mustFind: ["Paste"] },
  { q: "rosii", why: "tomatoes — fresh, and the word also appears as a colour adjective", mustFind: ["Rosii"] },
  { q: "ceapa", why: "onions — fresh onions, not dried seasoning that names them", mustFind: ["Ceapa"], topMustContain: "eapa" },
  { q: "mere", why: "apples — must not lead with anything whose name merely contains those letters", mustFind: ["Mere"] },
  { q: "hartie igienica", why: "toilet paper — a two-word category with many pack sizes", mustFind: ["Hartie igienica"] },
  { q: "detergent vase", why: "dishwashing liquid, not laundry detergent", mustFind: ["Detergent"], mustNotFindInTop: ["rufe"] },
  { q: "ulei floarea soarelui", why: "a household bottle; a 6-pack catering case is not the default answer", mustFind: ["Ulei"] },
  { q: "cafea", why: "coffee — which kind leads is arguable, so only presence is asserted", mustFind: ["Cafea"] },
];
