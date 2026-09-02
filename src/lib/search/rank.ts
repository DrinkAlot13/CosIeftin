// String-distance helpers for search. Nothing here knows about products.
//
// This file used to hold a whole second ranker — `rankSearch`, `scoreOne`, `brandsNamedIn`,
// `typoScore`, `correctQuery`. That ranker was replaced by `search/search.ts`, and leaving it
// in the tree would have been the failure this project keeps finding: two implementations of one
// question, diverging quietly, with nothing saying which one the site actually uses. The audit
// scripts kept importing THIS one after the app had moved on, so `npm run audit:search` was
// grading a ranker no visitor could reach.
//
// What survives is the part that has no opinion: edit distance and the typo budget.

/**
 * Edit budget by word length, so a typo is judged against how much of the word is left.
 *
 * One edit on a five-letter word is not evidence of a typo on its own: "lpate" and "spate"
 * differ by exactly one character and are unrelated words. On a ten-letter word, one edit almost
 * certainly is a typo. Same shape as Elasticsearch's AUTO fuzziness, for the same reason.
 */
function editBudget(len: number): number {
  if (len <= 2) return 0;
  if (len <= 5) return 1;
  return 2;
}

/**
 * Damerau-Levenshtein (optimal string alignment): like Levenshtein, but a TRANSPOSITION of two
 * adjacent characters costs one edit rather than two.
 *
 * This distinction is the whole ballgame for a search box. "lpate" is a transposition of "lapte"
 * and the single commonest way to mistype it — yet plain Levenshtein charges it 2, while
 * substituting an unrelated letter ("lpate" → "spate") costs 1. Under plain Levenshtein the
 * misspelling is therefore *closer* to a word the shopper did not mean, which is exactly what put
 * "Spinari si spate de pui" above every milk in the shop.
 */
export function damerau(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost);
      }
    }
  }
  return d[m][n];
}

/**
 * Is `token` a plausible misspelling of `target`?
 * Returns the similarity when it is, and 0 when it is not.
 */
export function fuzzyHit(token: string, target: string): number {
  if (!token || !target) return 0;
  if (token === target) return 1;
  const len = Math.max(token.length, target.length);
  const d = damerau(token, target);
  return d <= editBudget(len) ? 1 - d / len : 0;
}
