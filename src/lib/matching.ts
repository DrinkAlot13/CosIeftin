// Product matching utilities — the core engine of a price-comparison site.
// Offers are merged onto one canonical product first by GTIN (exact), then by a
// fuzzy signature (brand + normalized title tokens) for listings that have no GTIN.

const STOP = new Set(["cu", "de", "si", "la", "un", "o", "pentru", "the", "for", "and", "nou", "noua"]);

// Romanian uses comma-below ș/ț (U+0219/U+021B), but a lot of Romanian sites still emit the
// Turkish cedilla ş/ţ (U+015F/U+0163) — different codepoints that NFD does NOT unify (only the
// cedilla pair decomposes). Left unhandled, "brânzǎ Făgăraş" and "brânză Făgăraș" never match
// and search silently misses. Fold both families to plain ASCII first.
const RO_FOLD: Record<string, string> = {
  "ș": "s", "ț": "t", "Ș": "S", "Ț": "T", // comma-below ș ț Ș Ț
  "ş": "s", "ţ": "t", "Ş": "S", "Ţ": "T", // cedilla     ş ţ Ş Ţ
  "ă": "a", "Ă": "A", "â": "a", "Â": "A", // ă Ă â Â
  "î": "i", "Î": "I",                                 // î Î
};

/** Fold Romanian diacritics (both comma-below and cedilla forms) to ASCII. */
export function foldDiacritics(s: string): string {
  return s
    .replace(/[ȘșȚțŞşŢţĂăÂâÎî]/g, (c) => RO_FOLD[c] ?? c)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Lowercase, strip diacritics, join storage sizes (128 gb -> 128gb), keep alnum. */
export function normalizeText(s: string): string {
  return foldDiacritics(s)
    .toLowerCase()
    .replace(/(\d+)\s*(gb|tb|mb)\b/g, "$1$2")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function tokenize(s: string): Set<string> {
  return new Set(
    normalizeText(s)
      .split(/\s+/)
      .filter((t) => t.length > 0 && !STOP.has(t)),
  );
}

/** Levenshtein edit distance (for typo-tolerant search). */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

/** Jaccard similarity of two token sets (0..1). */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export type Candidate = { id: number; brand: string | null; tokens: Set<string> };

/** Build a candidate's signature tokens from its brand + name. */
export function signature(brand: string | null, name: string): Set<string> {
  return tokenize(`${brand ?? ""} ${name}`);
}

/**
 * Best fuzzy match for an incoming listing among candidates.
 * Brand must match when both sides declare one (cheap, high-precision blocker),
 * then rank by title-token Jaccard. Returns null if nothing clears the threshold.
 */
export function bestFuzzyMatch(
  brand: string | null,
  title: string,
  candidates: Candidate[],
  threshold = 0.5,
): { id: number; score: number } | null {
  const nb = brand ? normalizeText(brand) : "";
  const t = signature(brand, title);
  let best: { id: number; score: number } | null = null;
  for (const c of candidates) {
    if (nb && c.brand && normalizeText(c.brand) !== nb) continue; // brand blocker
    const score = jaccard(t, c.tokens);
    if (!best || score > best.score) best = { id: c.id, score };
  }
  return best && best.score >= threshold ? best : null;
}
