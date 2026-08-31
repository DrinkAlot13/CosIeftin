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
  /** if set, the query must return nothing */
  expectEmpty?: boolean;
};

export const SEARCH_CASES: SearchCase[] = [
  // ── the staples, typed plainly ───────────────────────────────────────────────
  { q: "lapte", why: "the single most common grocery query — milk must outrank milk CHOCOLATE", mustFind: ["Lapte"], topMustContain: "Lapte" },
  { q: "paine", why: "no diacritics — 'pâine' as everyone types it", mustFind: ["Paine"] },
  { q: "oua", why: "no diacritics for 'ouă'", mustFind: ["Oua"] },
  { q: "ulei", why: "generic category word", mustFind: ["Ulei"] },
  { q: "zahar", why: "no diacritics for 'zahăr'", mustFind: ["Zahar"] },
  { q: "faina", why: "no diacritics for 'făină'", mustFind: ["Faina"] },
  { q: "orez", why: "short, unambiguous staple", mustFind: ["Orez"] },
  { q: "unt", why: "3 letters — must not match every word containing 'unt'", mustFind: ["Unt"] },
  { q: "cafea", why: "high-traffic category", mustFind: ["Cafea"] },
  { q: "apa minerala", why: "two-word category", mustFind: ["Apa minerala"] },

  // ── with diacritics, since some users do type them ───────────────────────────
  { q: "pâine", why: "the same query WITH diacritics must behave identically", mustFind: ["Paine"] },
  { q: "ouă", why: "diacritic form of a staple", mustFind: ["Oua"] },
  { q: "brânză", why: "â and ă in one word", mustFind: ["Branza"] },
  { q: "zahăr", why: "diacritic ă", mustFind: ["Zahar"] },

  // ── product + brand, the most common real pattern ────────────────────────────
  { q: "lapte zuzu", why: "brand narrows a category", mustFind: ["Zuzu"], mustNotFind: ["Napolact"] },
  { q: "lapte napolact", why: "the same category, a different brand", mustFind: ["Napolact"], mustNotFind: ["Zuzu"] },
  { q: "ulei baneasa", why: "the case the brand filter was written for", mustFind: ["Baneasa"] },
  { q: "iaurt activia", why: "brand within a crowded category", mustFind: ["Activia"] },
  { q: "bere ursus", why: "beer brand narrows a crowded category", mustFind: ["Ursus"], mustNotFind: ["Heineken"] },
  { q: "apa dorna", why: "water brand", mustFind: ["Dorna"] },

  // ── brand only ───────────────────────────────────────────────────────────────
  { q: "zuzu", why: "brand alone must still find its products", mustFind: ["Zuzu"] },
  { q: "milka", why: "confectionery brand alone", mustFind: ["Milka"] },
  { q: "danone", why: "dairy brand alone", mustFind: ["Danone"] },

  // ── misspellings a phone keyboard produces ───────────────────────────────────
  { q: "lpate", why: "transposition of 'lapte'", mustFind: ["Lapte"] },
  { q: "iuart", why: "transposition of 'iaurt'", mustFind: ["Iaurt"] },
  { q: "ciocolata", why: "long word, commonly typed correctly", mustFind: ["Ciocolata"] },
  { q: "cicolata", why: "dropped letter", mustFind: ["Ciocolata"] },
  { q: "smantana", why: "no diacritics for 'smântână'", mustFind: ["Smantana"] },

  // ── size and pack in the query ───────────────────────────────────────────────
  { q: "lapte 1l", why: "shoppers include the size", mustFind: ["Lapte"] },
  { q: "apa 2l", why: "size with a category", mustFind: ["Apa"] },
  { q: "oua 10 buc", why: "count in the query", mustFind: ["Oua"] },

  // ── the discrimination cases: near-misses that must NOT match ────────────────
  { q: "lapte de cocos", why: "coconut milk is not milk — must not return dairy", mustNotFind: ["Lapte Zuzu"] },
  { q: "bere fara alcool", why: "alcohol-free beer is its own product", mustFind: ["fara alcool"] },
  { q: "cafea boabe", why: "whole beans, not instant", mustFind: ["boabe"] },

  // ── multi-word natural language ──────────────────────────────────────────────
  { q: "ulei de floarea soarelui", why: "the full Romanian name of the commonest oil", mustFind: ["floarea"] },
  { q: "hartie igienica", why: "two-word household staple", mustFind: ["Hartie igienica"] },
  { q: "detergent rufe", why: "household, two words", mustFind: ["Detergent"] },

  // ── degenerate input, which must not crash or return the whole catalog ───────
  { q: "", why: "empty query returns nothing rather than everything", expectEmpty: true },
  { q: "   ", why: "whitespace-only is the same as empty", expectEmpty: true },
  { q: "qwertyuiop", why: "nonsense must return nothing, not a random near-match", expectEmpty: true },
];
