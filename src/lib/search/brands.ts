// Knowing a brand by name — including the brands we do NOT sell.
//
// THE BUG THIS EXISTS FOR. "illy capsule" returned 208 coffee capsules, none of them illy. The
// old ranker did have a brand filter, and it was built from `brandsNamedIn(query, catalog)` —
// the brands the CATALOG HAS. We stock zero illy products, so no brand was recognised, no
// filter was applied, and the query fell through to fuzzy scoring on "capsule".
//
// That is not a tuning problem. A vocabulary derived from what we stock is structurally unable
// to notice a brand we do not stock, and "do we have this brand?" is exactly the question a
// brand query asks. So there are TWO vocabularies here and they answer different questions:
//
//   catalogBrands(catalog)  — brands we carry. Used to REQUIRE: "lapte zuzu" must return Zuzu.
//   KNOWN_BRANDS            — brands that exist in the world. Used to REFUSE: a query naming
//                             one of these that we cannot match is answered "we do not have
//                             it", not with the category it belongs to.
//
// KNOWN_BRANDS is a hand-written list, which CLAUDE.md is rightly suspicious of. It is safe
// here because it is ADDITIVE ONLY: a brand missing from the list degrades to today's
// behaviour (an ordinary unmatched term), never to a wrong claim. It is not used for matching,
// ranking, or anything a shopper sees as a price. It exists so we can say "no" precisely.

import { normalizeRo } from "../text/normalizeRo";

/**
 * Brands a Romanian shopper plausibly types. Presence here means "this word is a brand", NOT
 * "we stock it" — several of these we deliberately do not carry.
 *
 * Kept lowercase and diacritic-free, because that is what `normalizeRo` produces.
 */
export const KNOWN_BRANDS: ReadonlySet<string> = new Set([
  // coffee — the family the reported bug came from
  "illy", "lavazza", "jacobs", "nescafe", "tchibo", "doncafe", "segafredo", "starbucks",
  "tassimo", "nespresso", "dolce", "gusto", "eduscho", "julius", "meinl",
  // dairy
  "zuzu", "napolact", "danone", "activia", "muller", "hochland", "delaco", "olympus",
  "dorna", "covalact", "albalact", "pilos", "milbona", "yakult", "actimel", "philadelphia",
  "babybel", "lurpak", "president", "meggle", "almette",
  // drinks
  "coca", "pepsi", "fanta", "sprite", "schweppes", "borsec", "aqua", "carpatina",
  "izvorul", "biborteni", "perrier", "evian", "santal", "tymbark", "prigat", "cappy",
  "tropicana", "innocent", "redbull", "monster", "hell", "burn",
  // beer and spirits
  "ursus", "timisoreana", "ciuc", "bergenbier", "silva", "neumarkt", "heineken", "stella",
  "corona", "guinness", "jack", "daniels", "ballantines", "jameson",
  // sweets and snacks
  "milka", "poiana", "heidi", "kandia", "rom", "eugenia", "kinder", "nutella", "oreo",
  "toblerone", "haribo", "chio", "lays", "pringles", "croco", "gusto", "7days",
  // pasta, staples, tins
  "barilla", "baneasa", "panzani", "bucuria", "sam", "deroni", "raureni", "sultan",
  "kelloggs", "nestle", "weetabix", "quaker", "bonduelle", "heinz", "knorr", "maggi",
  "dr", "oetker", "vel", "pitar", "boromir", "titan", "arpis",
  // meat and deli
  "cristim", "caroli", "campofrio", "agricola", "fox", "elit", "sadu", "scandia",
  // household and personal care
  "ariel", "persil", "dero", "tide", "bonux", "lenor", "coccolino", "vernel",
  "fairy", "pur", "somat", "finish", "domestos", "cif", "ajax", "sano", "mr",
  "muscle", "duck", "bref", "glade", "airwick", "ambi", "pur",
  "zewa", "regina", "emeka", "pufina", "linteo",
  "nivea", "dove", "rexona", "axe", "old", "spice", "gillette", "colgate", "signal",
  "oral", "sensodyne", "parodontax", "listerine", "head", "shoulders", "pantene",
  "schauma", "syoss", "elseve", "loreal", "garnier", "palmolive", "protex", "fa",
  "pampers", "huggies", "libero", "always", "naturella", "kotex",
  // pet
  "whiskas", "pedigree", "purina", "friskies", "felix", "royal", "canin",
]);

/** Is this normalized token a brand name we recognise, whether or not we stock it? */
export function isKnownBrand(token: string): boolean {
  return KNOWN_BRANDS.has(normalizeRo(token));
}

export type BrandBearing = { name: string; brand?: string | null };

/**
 * Generic words that appear in the `brand` column and are not brands.
 *
 * The column is populated for 42.4% of products and carries retailer placeholders. Left in the
 * brand vocabulary they are catastrophic: "ciocolata milka" recognised BOTH words as brands and
 * the filter was `.some()`, so every chocolate in the shop passed. 681 of 761 results were not
 * Milka.
 */
const NOT_BRANDS: ReadonlySet<string> = new Set([
  "non", "brand", "nobrand", "no", "diverse", "altele", "generic", "x", "y", "n", "a",
  "produs", "marca", "propriu", "fara",
]);

/**
 * The brand tokens the catalog actually carries.
 *
 * A token qualifies when it appears in some product's `brand` column and is not a placeholder.
 * Tokens that are also common HEAD NOUNS are excluded: "ciocolata" appears as a brand value on a
 * few rows and as the head noun of hundreds of products, and treating it as a brand turns a
 * brand requirement into no requirement at all.
 */
export function catalogBrands(catalog: BrandBearing[], headNounFreq: Map<string, number>): Set<string> {
  const out = new Set<string>();
  for (const p of catalog) {
    if (!p.brand) continue;
    for (const t of normalizeRo(p.brand).split(/\s+/)) {
      if (t.length < 3 || NOT_BRANDS.has(t) || /^\d+$/.test(t)) continue;
      // A word used as the head noun of many products is a product word, not a brand.
      if ((headNounFreq.get(t) ?? 0) >= 5) continue;
      out.add(t);
    }
  }
  return out;
}
