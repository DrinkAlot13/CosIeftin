// VARIANT CLASSES: a difference here blocks a match outright, whatever the score says.
//
// THE PAGE THIS EXISTS FOR. Catalog product 5942204008190 — "Bautura carbogazoasa cu gust de
// zmeura Pepsi, doza, 6 x 0.33 l" — carried four offers from four merchants, and they were
// four DIFFERENT products. A user landed on a page saying Mega Image sells raspberry Pepsi
// six-packs for 10,49 when what Mega sells is a 2 L cola bottle.
//
// Six sessions of fixes made that page steadily more accurate about the wrong thing: the
// Auchan price was corrected to 11,69, the cheapest badge moved to the right row, the merchant
// count became honest. None of it helped, because the page should not have existed in that
// shape.
//
// WHY THE EXISTING RULES DID NOT CATCH IT:
//
//   • The size gate passed. 6 × 0.33 = 1.98 L against a 2 L bottle is a 1% difference and the
//     tolerance is 6%. Two completely different products agreed on total volume by accident.
//   • Mutual distinction fired but did not BLOCK. It returns REVIEW rather than REJECT
//     whenever the Jaccard score clears the review threshold, which "Bautura carbogazoasa
//     … Pepsi …" against "Bautura carbogazoasa … Pepsi …" comfortably does.
//   • `variantTokens` had no flavour words at all. `zmeura` and `cola` were, to the matcher,
//     ordinary descriptive tokens.
//
// So the rule here is deliberately blunt and deliberately EARLY: if the two names disagree
// within any of these classes, they are different products, and no amount of name overlap
// changes that. A flavour is not a description. Neither is a fat percentage, a sweetener
// choice, or a container format.
//
// The classes are kept SEPARATE rather than merged into one word list, because the block is
// on disagreement WITHIN a class. "zmeura" vs "doza" is not a contradiction — one is a
// flavour and the other a format, and a name may legitimately state one and not the other.
// "zmeura" vs "cola" is a contradiction. Merging the lists would lose that distinction and
// start rejecting real matches.

import { normalizeText } from "./matching";

export type VariantClass = "flavour" | "qualifier" | "fat" | "format";

/**
 * Words that name WHICH variant, grouped by the question they answer.
 *
 * All entries are pre-normalized (diacritics folded, lowercase) because they are compared
 * against `normalizeText` output.
 */
export const VARIANT_CLASSES: Record<VariantClass, ReadonlySet<string>> = {
  // Which flavour. The Pepsi case.
  flavour: new Set([
    "zmeura", "capsuni", "capsuna", "lamaie", "portocale", "portocala", "cola",
    "vanilie", "cirese", "cirese", "visine", "visina", "piersici", "piersica",
    "mango", "ananas", "pepene", "tropical", "afine", "mure", "kiwi", "banane",
    "ciocolata", "caramel", "menta", "cocos", "alune", "fistic", "capsuni",
    "mar", "mere", "para", "pere", "struguri", "grepfrut", "rodie", "lime",
  ]),
  // Which formulation. These change the product and usually the price.
  qualifier: new Set([
    "zero", "light", "max", "twist", "dietetic", "clasic", "classic",
    "intens", "extra", "forte", "plus", "original", "premium",
  ]),
  // Fat content, as a word or a percentage token.
  fat: new Set([
    "degresat", "degresata", "integral", "integrala", "semidegresat", "semidegresata",
    "slab", "gras", "grasime",
    "0.1", "1.5", "1.8", "2.5", "3.2", "3.5", "3.8",
  ]),
  // Which container. A can and a PET bottle are different products at different prices.
  format: new Set([
    "doza", "doze", "pet", "sticla", "sticle", "carton", "cutie", "cutii",
    "bidon", "galeata", "punga", "plic", "tetra",
  ]),
};

/**
 * "fara zahar" is a qualifier but it is TWO words, and the token scorer sees them apart.
 *
 * `fara` alone is meaningless — "fara gluten", "fara lactoza", "fara zahar" are different
 * claims — so the pair is matched as a phrase and reduced to one synthetic token.
 */
const QUALIFIER_PHRASES: [string, string, string][] = [
  ["fara", "zahar", "fara-zahar"],
  ["fara", "gluten", "fara-gluten"],
  ["fara", "lactoza", "fara-lactoza"],
  ["fara", "alcool", "fara-alcool"],
  ["fara", "cofeina", "fara-cofeina"],
];

/**
 * Tokens of a name, with the multi-word qualifiers folded into single tokens.
 *
 * PERCENTAGES ARE READ FROM THE RAW STRING, NOT THE NORMALIZED ONE. `normalizeText` strips
 * punctuation, so "Lapte 1.5%" normalizes to "lapte 1 5" — the decimal point and the percent
 * sign are both gone, and any fat token listed as "1.5" could never match. That is exactly
 * the doseTokens failure again: a rule present, referenced, and unable to fire.
 *
 * It was caught here by a test rather than by a user, and the rule-coverage table added the
 * same day would have caught it too, as `variant-fat` sitting at zero forever.
 */
export function variantTokensOf(name: string): Map<VariantClass, Set<string>> {
  const words = normalizeText(name).split(/[^a-z0-9.]+/).filter(Boolean);
  const set = new Set(words);
  // "1,5%" and "1.5 %" both become the token "1.5".
  for (const m of String(name).matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)) {
    set.add(m[1].replace(",", "."));
  }

  const out = new Map<VariantClass, Set<string>>();
  for (const k of Object.keys(VARIANT_CLASSES) as VariantClass[]) out.set(k, new Set());

  for (const [a, b, folded] of QUALIFIER_PHRASES) {
    for (let i = 0; i < words.length - 1; i++) {
      if (words[i] === a && words[i + 1] === b) out.get("qualifier")!.add(folded);
    }
  }
  for (const w of set) {
    for (const k of Object.keys(VARIANT_CLASSES) as VariantClass[]) {
      if (VARIANT_CLASSES[k].has(w)) out.get(k)!.add(w);
    }
  }
  return out;
}

export type VariantConflict = { klass: VariantClass; a: string[]; b: string[] } | null;

/**
 * Do these two names disagree WITHIN a variant class?
 *
 * Disagreement means both sides state a value in the same class and the values differ.
 * SILENCE IS NOT DISAGREEMENT — the same rule the matcher already applies to dosage. One name
 * saying "doza" and the other saying nothing about format is a fuller description, not a
 * contradiction; that case is still governed by mutual distinction and the overlap threshold.
 */
export function variantConflict(nameA: string, nameB: string): VariantConflict {
  const a = variantTokensOf(nameA);
  const b = variantTokensOf(nameB);
  for (const k of Object.keys(VARIANT_CLASSES) as VariantClass[]) {
    const sa = a.get(k)!;
    const sb = b.get(k)!;
    if (sa.size === 0 || sb.size === 0) continue;
    // Any shared value means they agree about this class.
    let shared = false;
    for (const v of sa) if (sb.has(v)) { shared = true; break; }
    if (!shared) return { klass: k, a: [...sa], b: [...sb] };
  }
  return null;
}
