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

/** The anchor noun: Romanian product names are noun-first ("Lapte Zuzu 1L"). */
export function headNounRo(input: string): string {
  return tokensRo(input)[0] ?? "";
}

/** Jaccard overlap of two token sets (0..1). */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  return intersection / (a.size + b.size - intersection);
}
