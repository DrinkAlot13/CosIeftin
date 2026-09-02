// Assigning a grocery product to a leaf of the tree, by name, with a confidence and a reason.
//
// THREE BANDS, the same shape as the matcher, and for the same reason: a wrong category is not
// a smaller version of no category. It puts body lotion in Lactate, and a shopper who finds it
// there stops believing the whole sidebar. So the assigner never guesses silently —
//
//   AUTO   >= 0.62  written
//   REVIEW >= 0.42  proposed, held for a human, NOT written
//   below           left unassigned, and counted
//
// The scoring has one idea in it worth stating: WHAT THE PRODUCT IS BEATS WHAT IT CONTAINS.
// Romanian names lead with the head noun — "Lapte Zuzu 3.5%" is milk, "Ciocolată cu lapte" is
// chocolate — so a match on the first token is worth far more than the same word later. Without
// that, every product containing "lapte" lands in Lactate, which is exactly the failure mode
// this project already hit in the matcher and in the search ranker.

import { normalizeRo } from "../text/normalizeRo";
import { ALL_LEAVES, GROCERY_TREE, catchAllSlugFor, type Leaf } from "./tree";

export const AUTO_THRESHOLD = 0.62;
export const REVIEW_THRESHOLD = 0.42;

export type Band = "AUTO" | "REVIEW" | "NONE";

export type Assignment = {
  leafSlug: string | null;
  department: string | null;
  score: number;
  band: Band;
  /** Machine-readable, so the audit can group by cause rather than re-deriving it. */
  reason: string;
  /** The runner-up, when there was a close one — a signal that the tree overlaps here. */
  runnerUp?: { leafSlug: string; score: number };
};

/**
 * Where does `needle` occur in the name, if at all? Returns the token index, or -1.
 *
 * PREFIX MATCHING for needles of 5+ characters, because Romanian inflects and the tree is
 * written in one form: "chifle" must match the rule "chifla", "rodii" must match "rodie",
 * "branzeturi" must match "branza". Short needles stay EXACT — "unt" must never match "munte"
 * and "apa" must never match "apartament", which whole-word matching is the only defence
 * against.
 */
function occursAt(nameNorm: string, words: string[], needle: string): number {
  const n = normalizeRo(needle);
  if (!n) return -1;
  if (n.includes(" ")) {
    const i = nameNorm.indexOf(n);
    if (i < 0) return -1;
    // Approximate the token index by counting words before the phrase.
    return nameNorm.slice(0, i).split(/\s+/).filter(Boolean).length;
  }
  if (n.length >= 5) {
    const idx = words.findIndex((w) => w.startsWith(n) || n.startsWith(w) && w.length >= 5);
    if (idx >= 0) return idx;
    return -1;
  }
  return words.indexOf(n);
}

/**
 * How much a match is worth, by position.
 *
 * The first token is NOT reliably the head noun in this catalog: Romanian grocery names lead
 * with the brand ("Napolact Lapte 3,5%"), the pack ("Pachet chefir Napolact") or the form
 * ("Crema de branza cu smantana"). Scoring only index 0 as strong put 9,179 products — 40% of
 * the catalog — into REVIEW, nearly all of them obviously correct. So the weight DECAYS over the
 * first few tokens instead of falling off a cliff after the first.
 */
function positionWeight(idx: number): number {
  if (idx === 0) return 0.95;
  if (idx === 1) return 0.90;
  if (idx === 2) return 0.82;
  if (idx === 3) return 0.70;
  return 0.50;
}

function scoreLeaf(nameNorm: string, words: string[], leaf: Leaf): { score: number; reason: string } {
  for (const a of leaf.avoid ?? []) {
    if (occursAt(nameNorm, words, a) >= 0) return { score: 0, reason: `avoided by "${a}"` };
  }
  let best = 0;
  let why = "";
  for (const m of leaf.match) {
    const idx = occursAt(nameNorm, words, m);
    if (idx < 0) continue;
    // A multi-word phrase is strong evidence wherever it sits — "lapte praf" is unambiguous.
    const total = Math.min(1, positionWeight(idx) + (m.includes(" ") ? 0.15 : 0));
    if (total > best) { best = total; why = `"${m}" at ${idx}`; }
  }
  return { score: best, reason: why };
}

/**
 * Assign one product name to a leaf.
 *
 * Ties are broken toward the leaf whose match was at the head noun; if two leaves both match at
 * the head with equal score the result is REVIEW rather than AUTO, because a genuine ambiguity
 * is exactly what a human should see. That is what `runnerUp` records.
 */
export function assignByName(productName: string): Assignment {
  const nameNorm = normalizeRo(productName);
  const words = nameNorm.split(/\s+/).filter(Boolean);
  if (words.length === 0) return { leafSlug: null, department: null, score: 0, band: "NONE", reason: "empty name" };

  const scored = ALL_LEAVES
    .map((l) => ({ leaf: l, ...scoreLeaf(nameNorm, words, l) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { leafSlug: null, department: null, score: 0, band: "NONE", reason: "no rule matched" };
  }

  const top = scored[0];
  const second = scored[1];
  let score = top.score;
  let reason = top.reason;

  // An unbroken tie between two departments is ambiguity, not confidence. Demote it so a human
  // sees it, and say so — this is where "Lapte de cocos" (Lactate vs Băcănie) has to land.
  if (second && second.score === top.score && second.leaf.department !== top.leaf.department) {
    score = Math.min(score, REVIEW_THRESHOLD + 0.1);
    reason = `${reason} — tied with ${second.leaf.slug}`;
  }

  const band: Band = score >= AUTO_THRESHOLD ? "AUTO" : score >= REVIEW_THRESHOLD ? "REVIEW" : "NONE";
  return {
    leafSlug: top.leaf.slug,
    department: top.leaf.department,
    score,
    band,
    reason,
    runnerUp: second ? { leafSlug: second.leaf.slug, score: second.score } : undefined,
  };
}

/** Words that carry no taxonomic weight in a merchant's own path label. */
const PATH_FILLER = new Set(["produse", "si", "de", "la", "din", "cu", "pentru", "alte", "altele"]);

function pathTokens(level: string): Set<string> {
  return new Set(normalizeRo(level).split(/\s+/).filter((t) => t && !PATH_FILLER.has(t)));
}

/**
 * Is this path level the merchant NAMING A DEPARTMENT rather than a shelf?
 *
 * This is the distinction that was missing, and its absence is what made two leaves into
 * catch-alls. "Lactate si oua" is Sezamo's department; scored as a product name it matches the
 * word `oua` and files every cheese under Eggs. A department name must never be allowed to pick
 * a leaf — the merchant did not tell us a shelf, and inventing one is the same error as filling
 * a gap with a plausible value.
 *
 * Deliberately strict: the level's tokens must CONTAIN all of the department's own tokens.
 * "produse congelate" ⊇ {congelate} matches Congelate; "curatenie si intretinere" does NOT match
 * "Curățenie și igienă", because `igiena` is absent and a partial overlap is a guess. An
 * unmatched level stays unmapped, which is the honest outcome and is counted.
 */
function departmentFromLevel(level: string): string | null {
  const lv = pathTokens(level);
  if (lv.size === 0) return null;
  for (const d of GROCERY_TREE) {
    const dt = pathTokens(d.label);
    const st = new Set(d.slug.split("-").filter((t) => !PATH_FILLER.has(t)));
    const covers = (need: Set<string>) => need.size > 0 && [...need].every((t) => lv.has(t));
    if (covers(dt) || covers(st)) return d.slug;
  }
  return null;
}

/**
 * Map a MERCHANT-supplied path onto our tree.
 *
 * Preferred over `assignByName` wherever it exists: the merchant is describing its own shelf and
 * we are guessing from a string. Matching is on the deepest level first, then outward, because
 * "Lactate si oua / Oua / Oua de gaina" should land on Ouă rather than on the department — and a
 * level that names only the DEPARTMENT is now recorded as such rather than scored as a product.
 */
export function assignByMerchantPath(levels: string[]): Assignment {
  let department: string | null = null;
  for (const level of [...levels].reverse()) {
    // A department name is recorded and then SKIPPED, never scored as a product name.
    const d = departmentFromLevel(level);
    if (d) { department ??= d; continue; }
    const a = assignByName(level);
    // A shelf-level word scores low as a product name; accept a REVIEW-band hit here because
    // the SOURCE is authoritative even when the wording is generic.
    if (a.leafSlug && a.score >= REVIEW_THRESHOLD) {
      return { ...a, band: "AUTO", score: Math.max(a.score, AUTO_THRESHOLD), reason: `merchant path "${level}" — ${a.reason}` };
    }
  }
  if (department) {
    // The merchant told us a department and nothing finer. That is a real fact, and it belongs
    // in a leaf that says so.
    return {
      leafSlug: catchAllSlugFor(department),
      department,
      score: AUTO_THRESHOLD,
      band: "AUTO",
      reason: `merchant named the department "${department}" and no shelf — filed as Altele`,
    };
  }
  return { leafSlug: null, department: null, score: 0, band: "NONE", reason: `merchant path unmapped: ${levels.join(" / ")}` };
}
