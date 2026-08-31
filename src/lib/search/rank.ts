// Product search ranking — the scoring, extracted from the database query.
//
// It lived inside `searchProducts`, which loads the catalog and scores it in one function.
// That made search quality untestable: measuring whether "lapte zuzu" finds the right milk
// needed a database, a scrape, and a running app, so nobody measured it and every change to
// the scoring was a guess.
//
// Everything here is pure. `tests/search-quality.test.ts` runs 40 real Romanian queries
// against a fixed catalog and asserts what must and must not come back.

import { normalizeText, tokenize, jaccard, levenshtein } from "../matching";
import { headNounRo } from "../text/normalizeRo";

/** The minimum a product must score to be shown at all. */
export const SEARCH_THRESHOLD = 0.35;

/**
 * How much it is worth for a query word to be the product's HEAD NOUN rather than a modifier.
 *
 * Searching "lapte" returned "Ciocolata cu lapte Milka" above actual milk, because the word is
 * present either way and nothing distinguished what the product IS from what it contains. In
 * Romanian the head noun leads the name — "Lapte Zuzu 3.5%" is milk, "Ciocolata cu lapte" is
 * chocolate — so matching there is worth far more than matching anywhere else.
 *
 * This is a boost, not a filter. Milk chocolate still appears for "lapte"; it appears below the
 * milk, which is what a shopper means. Filtering it out would break "lapte de cocos", where the
 * head noun is genuinely "lapte" and the shopper genuinely wants coconut milk.
 */
export const HEAD_NOUN_BONUS = 0.6;

/**
 * Edit budget by word length, so a typo is judged against how much of the word is left.
 *
 * One edit on a five-letter word is not evidence of a typo on its own: "lpate" and "spate"
 * differ by exactly one character and are unrelated words. On a ten-letter word, one edit
 * almost certainly is a typo. Same shape as Elasticsearch's AUTO fuzziness, for the same
 * reason.
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
 * This distinction is the whole ballgame for a search box. "lpate" is a transposition of
 * "lapte" and the single commonest way to mistype it — yet plain Levenshtein charges it 2,
 * while substituting an unrelated letter ("lpate" → "spate") costs 1. Under plain Levenshtein
 * the misspelling is therefore *closer* to a word the shopper did not mean, which is exactly
 * what put "Spinari si spate de pui" above every milk in the shop.
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

/**
 * Vocabulary of head nouns the catalog actually uses, with how often each appears.
 *
 * The frequency is the point. "lpate" is one transposition from "lapte" and one substitution
 * from "spate", and no string metric can break that tie — both are legal Romanian words at the
 * same distance. What breaks it is the catalog: milk is a head noun on hundreds of products,
 * "spate" on a handful. A misspelling is far likelier to target the common word. That is how
 * every spelling corrector works — edit distance proposes, prior frequency disposes.
 */
export function headNounVocabulary<T extends Rankable>(catalog: T[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const p of catalog) {
    const h = headNounRo(p.name);
    if (h) freq.set(h, (freq.get(h) ?? 0) + 1);
  }
  return freq;
}

/**
 * Correct a query against the catalog's own vocabulary before searching with it.
 *
 * A token the catalog already knows is left completely alone — correction only ever applies to
 * a word no product uses, so a real query can never be "corrected" into a different one.
 */
export function correctQuery(query: string, vocab: Map<string, number>): { corrected: string; changes: [string, string][] } {
  const changes: [string, string][] = [];
  const out = query.split(/(\s+)/).map((word) => {
    const t = normalizeText(word);
    if (!t || /\d/.test(t) || t.length < 3 || vocab.has(t)) return word;
    let best = "";
    let bestFreq = 0;
    let bestSim = 0;
    for (const [cand, freq] of vocab) {
      const sim = fuzzyHit(t, cand);
      if (sim === 0) continue;
      // Closer wins; among equally close candidates, the one the catalog uses more.
      if (sim > bestSim || (sim === bestSim && freq > bestFreq)) {
        best = cand; bestFreq = freq; bestSim = sim;
      }
    }
    if (best && best !== t) { changes.push([t, best]); return best; }
    return word;
  }).join("");
  return { corrected: out, changes };
}

export type Rankable = {
  name: string;
  brand?: string | null;
};

export type Ranked<T extends Rankable> = {
  item: T;
  score: number;
  /** why it matched — for the search-quality audit, not for the UI */
  reason: string;
};

/**
 * Average best-token similarity, so "lpate" still finds "lapte".
 * Deliberately generous: a Romanian shopper types on a phone, often without diacritics.
 */
export function typoScore(qTokens: Set<string>, tTokens: string[]): number {
  if (qTokens.size === 0) return 0;
  let sum = 0;
  for (const q of qTokens) {
    let best = 0;
    for (const t of tTokens) {
      const sim = 1 - levenshtein(q, t) / Math.max(q.length, t.length);
      if (sim > best) best = sim;
    }
    sum += best;
  }
  return sum / qTokens.size;
}

/**
 * The brands the query names, drawn from the catalog's own brands rather than a list.
 *
 * This is what makes "ulei baneasa" show Băneasa oil instead of every oil in the shop. It has
 * to come from the catalog: a hand-written brand list is wrong the day a new brand is scraped.
 */
export function brandsNamedIn<T extends Rankable>(query: string, catalog: T[]): string[] {
  const nq = normalizeText(query);
  const qTokens = tokenize(query);
  const brandNorms = new Set<string>();
  const brandTokens = new Set<string>();
  for (const p of catalog) {
    if (!p.brand) continue;
    const nb = normalizeText(p.brand);
    if (nb.length >= 3) brandNorms.add(nb);
    for (const t of tokenize(p.brand)) if (t.length >= 3) brandTokens.add(t);
  }
  const named = new Set<string>();
  for (const nb of brandNorms) if (nq.includes(nb)) named.add(nb);
  for (const t of qTokens) if (brandTokens.has(t)) named.add(t);
  return [...named];
}

/** Score one product against a query. Pure; no catalog context beyond the product itself. */
export function scoreOne<T extends Rankable>(query: string, item: T): Ranked<T> {
  const nq = normalizeText(query);
  const qTokens = tokenize(query);
  const hay = normalizeText(`${item.brand ?? ""} ${item.name}`);
  const tTokens = [...tokenize(`${item.brand ?? ""} ${item.name}`)];

  const reasons: string[] = [];
  let score = 0;
  if (hay.includes(nq)) { score += 1; reasons.push("substring"); }
  if (hay.startsWith(nq)) { score += 0.3; reasons.push("prefix"); }
  const j = jaccard(qTokens, new Set(tTokens));
  if (j > 0) { score += j * 0.8; reasons.push(`tokens ${j.toFixed(2)}`); }
  const t = typoScore(qTokens, tTokens);
  if (t > 0) { score += t * 0.6; reasons.push(`typo ${t.toFixed(2)}`); }

  // What the product IS beats what the product CONTAINS — and this has to survive a typo,
  // or the misspelling that most needs help is the one case the rule cannot reach. Searching
  // "lpate" used to return 1,195 products led by "Spinari si spate de pui", because typo
  // similarity alone both qualified a result and ranked it, and "spate" is one edit from
  // "lpate". Letting the head-noun bonus match fuzzily puts the actual milk back on top
  // without touching the threshold — which the tradeoff curve showed was the wrong knob:
  // raising it from 0.35 to 0.45 cost recall and left the median result count unchanged.
  const head = headNounRo(item.name);
  if (head) {
    let bestHead = 0;
    for (const q of qTokens) {
      const sim = fuzzyHit(q, head);
      if (sim > bestHead) bestHead = sim;
    }
    if (bestHead > 0) {
      score += HEAD_NOUN_BONUS * bestHead;
      reasons.push(bestHead === 1 ? "head-noun" : `head-noun~${bestHead.toFixed(2)}`);
    }
  }

  return { item, score, reason: reasons.join(" + ") || "none" };
}

/**
 * Rank a catalog against a query: score, drop anything under the threshold, and — when the
 * query names a brand we carry — keep only that brand.
 */
export function rankSearch<T extends Rankable>(query: string, catalog: T[]): Ranked<T>[] {
  const raw = query.trim();
  if (!raw) return [];
  // Correct the query BEFORE scoring, against the catalog's own words. Scoring a misspelling
  // directly makes every product a fuzzy near-miss; scoring the corrected word makes the right
  // products exact hits and the rest fall away on their own.
  const q = correctQuery(raw, headNounVocabulary(catalog)).corrected;
  const required = brandsNamedIn(q, catalog);
  return catalog
    .map((item) => scoreOne(q, item))
    .filter((r) => r.score >= SEARCH_THRESHOLD)
    .filter((r) => {
      if (required.length === 0) return true;
      const hay = normalizeText(`${r.item.brand ?? ""} ${r.item.name}`);
      return required.some((b) => hay.includes(b));
    })
    .sort((a, b) => b.score - a.score);
}
