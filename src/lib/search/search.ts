// Product search: what we return, and — the part that was missing — what we refuse to return.
//
// "illy capsule" returned 208 products, none of them illy, because the ranker had no way to
// conclude "we do not stock this". Its brand filter was derived from the brands the catalog
// HAS, so a brand we lack produced no filter and the query fell through to fuzzy scoring on
// "capsule". The one case where a shopper most needs a straight answer was the one case the
// design could not produce one for.
//
// The rule here is simple and it is about honesty rather than relevance:
//
//     A QUERY TERM WE CANNOT MATCH IS REPORTED, NOT DROPPED.
//
// Anything shown alongside an unmatched term is an ALTERNATIVE and is labelled as one. We never
// silently answer a narrower question than the one asked — the same principle as withholding a
// price we cannot defend rather than showing a plausible one.
//
// Everything here is pure. `tests/search-quality.test.ts` runs 40 real Romanian queries against
// a frozen catalog; `npm run audit:search-quality` runs the same 40 against the live one.

import { normalizeRo, isStopword } from "../text/normalizeRo";
import { headNounRo } from "../text/normalizeRo";
import { catalogBrands, isKnownBrand, type BrandBearing } from "./brands";
import { fuzzyHit } from "./rank";

/** The minimum a product must score to be shown at all. */
export const SEARCH_THRESHOLD = 0.35;

/** Ranking tiers, per the brief: exact name, then brand, then category, then fuzzy. */
export const TIER = { EXACT: 400, PHRASE: 300, BRAND: 200, CATEGORY: 100, FUZZY: 0 } as const;

export type Searchable = {
  name: string;
  brand?: string | null;
  categoryName?: string | null;
  /** How many DISTINCT merchants show a price for this product right now. Tie-breaker. */
  merchantCount?: number;
};

export type Ranked<T extends Searchable> = {
  item: T;
  score: number;
  tier: number;
  /** why it matched — for the search-quality audit, not for the UI */
  reason: string;
};

export type SearchOutcome<T extends Searchable> = {
  /**
   * `results`     — ordinary hits.
   * `brand-miss`  — at least one query term matched nothing we stock. `results` are
   *                 ALTERNATIVES and the UI must label them as such.
   * `empty`       — nothing to show and nothing specific to say.
   */
  kind: "results" | "brand-miss" | "empty";
  /** Query terms we could not match to anything showable. Shown to the user verbatim. */
  missing: string[];
  results: Ranked<T>[];
  /** Typo corrections applied, so the UI can say "am căutat X". */
  corrections: [string, string][];
};

/** Content tokens of a query: what a shopper is actually asking for. */
function queryTokens(q: string): string[] {
  return normalizeRo(q)
    .split(/\s+/)
    .filter((t) => t.length > 0 && !isStopword(t));
}

/** Every token the catalog uses, with the number of products using it. */
export function catalogVocabulary(catalog: Searchable[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const p of catalog) {
    const seen = new Set(normalizeRo(`${p.brand ?? ""} ${p.name}`).split(/\s+/).filter(Boolean));
    for (const t of seen) freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  return freq;
}

function headNounFrequency(catalog: Searchable[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const p of catalog) {
    const h = headNounRo(p.name);
    if (h) freq.set(h, (freq.get(h) ?? 0) + 1);
  }
  return freq;
}

/**
 * Correct one token against the catalog's own vocabulary.
 *
 * Frequency is the tie-break and it is doing real work: "lpate" is one edit from "lapte"
 * (transposition), one from "pate" (deletion) and one from "spate" (substitution). No string
 * metric can separate them — all three are legal words at distance 1. The catalog can: milk
 * appears on ~1,100 products, pâté on a hundred. Edit distance proposes, prior frequency
 * disposes, which is how every spelling corrector works. The old version ranked against
 * head-noun frequency only and chose "pate", which put "Pate de porc Sadu" on top of the
 * commonest misspelling on the site.
 *
 * A KNOWN BRAND IS NEVER CORRECTED. "illy" is two edits from "lily" and one from "milly"; if
 * correction were allowed to touch it, the brand-miss this whole module exists for would be
 * silently converted into a match for something else.
 */
/**
 * A token this rare is evidence of a typo IN THE CATALOG, not of a word the shopper meant.
 *
 * "cicolata" is a misspelling on exactly ONE product name. Because it existed, the corrector
 * treated the query as already correct and returned that single product for a query that plainly
 * means chocolate — 734 products use the correct spelling. A word the catalog uses once, with a
 * near-neighbour it uses seven hundred times, is a typo on both sides.
 */
const RARE_MAX = 2;
const DOMINANCE = 20;

function correctToken(t: string, vocab: Map<string, number>): string | null {
  const own = vocab.get(t) ?? 0;
  const rare = own > 0 && own <= RARE_MAX;
  if (own > 0 && !rare) return t;
  if (t.length < 3 || /\d/.test(t)) return own > 0 ? t : null;
  if (isKnownBrand(t)) return own > 0 ? t : null;
  let best: string | null = null;
  let bestSim = 0;
  let bestFreq = 0;
  for (const [cand, freq] of vocab) {
    if (cand === t) continue;
    const sim = fuzzyHit(t, cand);
    if (sim === 0) continue;
    if (sim > bestSim || (sim === bestSim && freq > bestFreq)) {
      best = cand; bestSim = sim; bestFreq = freq;
    }
  }
  // A rare token keeps itself unless a neighbour is overwhelmingly more common.
  if (rare) return best && bestFreq >= own * DOMINANCE && bestFreq >= 20 ? best : t;
  return best;
}

/** Score one product against the resolved query tokens. Pure. */
export function scoreOne<T extends Searchable>(
  tokens: string[],
  phrase: string,
  item: T,
  requiredBrands: string[],
): Ranked<T> {
  const name = normalizeRo(item.name);
  const hay = normalizeRo(`${item.brand ?? ""} ${item.name}`);
  const cat = normalizeRo(item.categoryName ?? "");
  const nameTokens = new Set(name.split(/\s+/).filter(Boolean));
  const hayTokens = new Set(hay.split(/\s+/).filter(Boolean));

  const reasons: string[] = [];
  let tier: number = TIER.FUZZY;

  if (name === phrase) { tier = TIER.EXACT; reasons.push("exact-name"); }
  else if (phrase.length > 0 && name.includes(phrase)) { tier = TIER.PHRASE; reasons.push("name-phrase"); }
  else if (requiredBrands.length > 0 && requiredBrands.every((b) => hayTokens.has(b))) { tier = TIER.BRAND; reasons.push("brand"); }
  else if (cat && tokens.some((t) => cat.split(/\s+/).includes(t))) { tier = TIER.CATEGORY; reasons.push("category"); }

  // Within a tier: how much of the query the product actually accounts for.
  let hit = 0;
  for (const t of tokens) if (hayTokens.has(t)) hit++;
  const coverage = tokens.length === 0 ? 0 : hit / tokens.length;
  let score = coverage;
  if (coverage > 0) reasons.push(`coverage ${coverage.toFixed(2)}`);

  // What the product IS beats what the product CONTAINS. "Ciocolata cu lapte" contains milk;
  // "Lapte Zuzu" is milk. In Romanian the head noun leads the name, so a query word landing
  // there is worth more than the same word anywhere else. A boost, never a filter — "lapte de
  // cocos" is a real query whose head noun genuinely is lapte.
  const head = headNounRo(item.name);
  if (head) {
    let bestHead = 0;
    for (const t of tokens) {
      const sim = fuzzyHit(t, head);
      if (sim > bestHead) bestHead = sim;
    }
    if (bestHead > 0) {
      score += 0.6 * bestHead;
      reasons.push(bestHead === 1 ? "head-noun" : `head-noun~${bestHead.toFixed(2)}`);
    }
  }

  // A near-miss on spelling still counts for something, but never as much as a real hit.
  if (hit < tokens.length) {
    let fuzzy = 0;
    for (const t of tokens) {
      if (hayTokens.has(t)) continue;
      let bestTok = 0;
      for (const ht of nameTokens) {
        const sim = fuzzyHit(t, ht);
        if (sim > bestTok) bestTok = sim;
      }
      fuzzy += bestTok;
    }
    const f = fuzzy / tokens.length;
    if (f > 0) { score += f * 0.4; reasons.push(`fuzzy ${f.toFixed(2)}`); }
  }

  return { item, score, tier, reason: reasons.join(" + ") || "none" };
}

/**
 * Search a catalog.
 *
 * The catalog handed in MUST already be restricted to showable products — in stock, not stale,
 * not withheld, from an active merchant. That filter belongs at the query, not here, and this
 * module cannot enforce it; `searchProducts` in lib/queries.ts is the enforcing caller and
 * `tests/search-quality.test.ts` pins the rule.
 */
/**
 * The three catalog-wide derivations `searchCatalog` needs, and the ONLY expensive part of it.
 *
 * Vocabulary (for typo correction and "is this word ours"), head-noun frequency, and the brand
 * set. All three are pure functions of the catalog and change once a night; rebuilding them per
 * request cost 213-241 ms of the 880 ms `/search` was taking. Extracted so a caller can build
 * them once and hand them in — see lib/search/index-cache.
 *
 * NOTHING about the honesty guarantee moves: the index is still derived from the WHOLE catalog,
 * so "we do not stock illy" is decided against everything we carry. What changes is how often.
 */
export type SearchIndex = {
  vocab: Map<string, number>;
  headFreq: Map<string, number>;
  brands: Set<string>;
};

export function buildSearchIndex<T extends Searchable>(catalog: T[]): SearchIndex {
  const vocab = catalogVocabulary(catalog);
  const headFreq = headNounFrequency(catalog);
  const brands = catalogBrands(catalog as BrandBearing[], headFreq);
  return { vocab, headFreq, brands };
}

export function searchCatalog<T extends Searchable>(
  query: string,
  catalog: T[],
  index?: SearchIndex,
): SearchOutcome<T> {
  const empty = (missing: string[] = []): SearchOutcome<T> =>
    ({ kind: missing.length ? "empty" : "empty", missing, results: [], corrections: [] });

  const rawTokens = queryTokens(query);
  if (rawTokens.length === 0) return empty();

  // Built here when no caller supplied one, so every existing call site and every test keeps
  // working unchanged — the cache is an optimisation, never a second code path.
  const { vocab, brands } = index ?? buildSearchIndex(catalog);

  // Resolve each token to something the catalog knows, or record it as missing.
  const resolved: string[] = [];
  const missing: string[] = [];
  const corrections: [string, string][] = [];
  for (const t of rawTokens) {
    const c = correctToken(t, vocab);
    if (c == null) { missing.push(t); continue; }
    if (c !== t) corrections.push([t, c]);
    resolved.push(c);
  }

  // Nothing we recognise. Say which term failed when it is a brand we know of, because
  // "we do not stock illy" and "we found nothing" are different answers to the shopper.
  if (resolved.length === 0) {
    const namedBrand = missing.some((m) => isKnownBrand(m));
    return { kind: namedBrand ? "brand-miss" : "empty", missing, results: [], corrections };
  }

  // Brands the query names AND we carry are REQUIRED — every one of them, not any one.
  // The old filter used `.some()`, so "ciocolata milka" (where "ciocolata" was also read as a
  // brand) admitted every chocolate in the shop: 681 of 761 results were not Milka.
  //
  // A brand counts as "ours" if it is in the brand COLUMN or it is a brand we recognise and the
  // catalog uses the word at all. The column alone is not enough: it is populated for 42.4% of
  // products, and Zuzu — one of the most searched dairy brands in Romania — appears only inside
  // product NAMES ("ZUZU Lapte Semidegresat 1.5% 1 L"). Requiring only column-brands left
  // "lapte zuzu" returning 515 products of which 495 were not Zuzu.
  const requiredBrands = resolved.filter((t) => brands.has(t) || (isKnownBrand(t) && vocab.has(t)));
  const phrase = resolved.join(" ");

  // EVERY query word must actually be in the product. A shopper typing two words is narrowing,
  // not offering alternatives: "detergent rufe" returned "Detergent de vase Fairy" because
  // "detergent" alone cleared the threshold and the head-noun bonus carried it. `rufe` is the
  // entire point of that query.
  const hayTokensOf = (item: T): Set<string> =>
    new Set(normalizeRo(`${item.brand ?? ""} ${item.name}`).split(/\s+/).filter(Boolean));

  let ranked = catalog
    .filter((item) => {
      const h = hayTokensOf(item);
      return resolved.every((t) => h.has(t));
    })
    .map((item) => scoreOne(resolved, phrase, item, requiredBrands))
    .filter((r) => r.score >= SEARCH_THRESHOLD);

  if (requiredBrands.length > 0) {
    ranked = ranked.filter((r) => {
      const h = hayTokensOf(r.item);
      return requiredBrands.every((b) => h.has(b));
    });
  }

  const order = (a: Ranked<T>, b: Ranked<T>): number =>
    b.tier - a.tier ||
    b.score - a.score ||
    // A product priced in four shops is more useful than the same product priced in one.
    (b.item.merchantCount ?? 0) - (a.item.merchantCount ?? 0) ||
    a.item.name.localeCompare(b.item.name);

  ranked.sort(order);

  // WE CARRY THE BRAND, JUST NOT THAT PRODUCT. "ulei baneasa" has no answer — Băneasa makes
  // flour and pasta, and none of its 75 products is an oil. The old search returned 75 results
  // led by "Baneasa Malai", answering with the brand and quietly dropping "ulei"; requiring
  // every word correctly gives nothing, but a blank page tells the shopper nothing either.
  //
  // So: name the term that failed and offer the brand's real range. This is the same rule as
  // the unstocked-brand case — report what did not match, never substitute for it.
  if (ranked.length === 0 && requiredBrands.length > 0 && resolved.length > requiredBrands.length) {
    const others = resolved.filter((t) => !requiredBrands.includes(t));
    const brandOnly = catalog
      .filter((item) => {
        const h = hayTokensOf(item);
        return requiredBrands.every((b) => h.has(b));
      })
      .map((item) => scoreOne(requiredBrands, requiredBrands.join(" "), item, requiredBrands))
      .sort(order);
    if (brandOnly.length > 0) {
      return { kind: "brand-miss", missing: [...missing, ...others], results: brandOnly, corrections };
    }
  }

  if (missing.length > 0) return { kind: "brand-miss", missing, results: ranked, corrections };
  return { kind: ranked.length > 0 ? "results" : "empty", missing, results: ranked, corrections };
}
