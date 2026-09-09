// Romanian text normalization. Run this before ANY tokenization, matching or search
// indexing (see CLAUDE.md → Romanian text normalization).
//
// THE reason this module exists: Romanian ș/ț have TWO Unicode encodings that both appear
// in scraped data and that NFD does not unify —
//
//   ș U+0219 (comma below)   vs   ş U+015F (cedilla)
//   ț U+021B (comma below)   vs   ţ U+0163 (cedilla)
//
// Correct Romanian is comma-below, but a great many Romanian sites still emit the Turkish
// cedilla forms, and some emit both on the same page. Unfolded, "Făgăraș" and "Făgăraş"
// are simply different strings: matching misses, search misses, and it is miserable to
// debug because the two look identical in most fonts.

/** Every Romanian diacritic, both encodings, mapped to ASCII. */
const FOLD: Record<string, string> = {
  // comma-below (correct Romanian)
  "ș": "s", "Ș": "s", // ș Ș
  "ț": "t", "Ț": "t", // ț Ț
  // cedilla (Turkish codepoints, widely mis-used for Romanian)
  "ş": "s", "Ş": "s", // ş Ş
  "ţ": "t", "Ţ": "t", // ţ Ţ
  // a-breve and a-circumflex
  "ă": "a", "Ă": "a", // ă Ă
  "â": "a", "Â": "a", // â Â
  // i-circumflex
  "î": "i", "Î": "i", // î Î
};

const DIACRITIC_RE = /[ȘșȚțŞşŢţĂăÂâÎî]/g;

/**
 * Fold Romanian diacritics (BOTH comma-below and cedilla encodings) to ASCII.
 * Case is preserved — use `normalizeRo` when you also want lowercasing.
 */
export function foldDiacritics(input: string): string {
  return (
    input
      .replace(DIACRITIC_RE, (c) => FOLD[c] ?? c)
      // catch any remaining combining marks (e.g. precomposed forms from other locales)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
  );
}

/**
 * The canonical normalization: lowercase, fold diacritics, strip punctuation,
 * collapse whitespace. This is what matching and search index on.
 *
 *   normalizeRo("Brânză Telemea Făgăraş, 400 g!")  ->  "branza telemea fagaras 400 g"
 */
export function normalizeRo(input: string | null | undefined): string {
  if (input == null) return "";
  return foldDiacritics(String(input))
    .toLowerCase()
    // keep digits and letters; everything else becomes a separator
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Romanian words that never make a useful matching anchor. */
const STOPWORDS = new Set([
  "de", "cu", "la", "si", "din", "fara", "pentru", "sau", "un", "o", "cel", "the", "and", "for",
]);

export function isStopword(token: string): boolean {
  return STOPWORDS.has(token);
}

/**
 * Tokens for MATCHING/BLOCKING: at least 3 characters, no digits, no stopwords.
 * Short tokens are useless as an index key — they match everything.
 */
export function tokensRo(input: string): string[] {
  return normalizeRo(input)
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !/\d/.test(t));
}

/**
 * Tokens for SCORING overlap: every alphabetic token, INCLUDING short ones.
 *
 * Short tokens are exactly where product variants hide — "Brut" vs "Rose",
 * "Cuvée I" vs "Cuvée IX". Dropping tokens under 3 characters silently merges distinct
 * bottles, which is how one Carrefour wine ended up backing 64 unrelated products.
 * Numbers stay out: size is checked separately and would inflate the score.
 */
export function overlapTokensRo(input: string): string[] {
  return normalizeRo(input)
    .split(/\s+/)
    .filter((t) => t.length >= 1 && !STOPWORDS.has(t) && !/\d/.test(t));
}

/**
 * The FIRST significant token of a name. Romanian product names are noun-first ("Lapte Zuzu 1L").
 *
 * ── IT MUST NOT BE BRAND-AWARE, AND IT WAS ONCE RENAMED FOR SAYING SO BADLY.
 *
 * This was called `headNounRo`, which made it look like a stale third copy of
 * `scrape-util.headNoun` — the register in `check:concepts` recorded it as exactly that, on an
 * assumption nobody had measured. Measured across all 56,609 product names it disagrees with the
 * matcher's head noun on **11.8%**, and on inspection the difference is not staleness:
 *
 *     Oua de Sibiu, marime L    headNoun → "marime"    this → "oua"
 *     Kiwi gold, 500 g          headNoun → "gold"      this → "kiwi"
 *
 * `headNoun` skips the brand ON PURPOSE, so a brand-first name can still find its counterpart.
 * That is right for matching and wrong here, because the one thing this feeds is
 * `catalogBrands`, which excludes a candidate brand token when it is *also* a common leading
 * noun ("ciocolata" is a brand value on a few rows and the head of hundreds of products). A
 * brand-aware version returns zero for every brand by construction, the exclusion never fires,
 * and a brand requirement quietly becomes no requirement at all.
 *
 * So: two functions, two purposes, one of which was badly named. Named for what it does now.
 */
export function leadTokenRo(input: string): string {
  return tokensRo(input)[0] ?? "";
}

/** Jaccard overlap of two token sets (0..1). */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  return intersection / (a.size + b.size - intersection);
}
