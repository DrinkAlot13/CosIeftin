// Product classes this site does not carry, refused at the pool before they can be matched.
//
// TOBACCO AND NICOTINE.
//
// Romanian law (Legea 349/2002, as amended, on preventing tobacco consumption) prohibits
// advertising and promotion of tobacco products, with narrow exceptions for the specialist
// trade press and for material inside the point of sale. Legea 201/2016 extends the regime to
// electronic cigarettes and refill containers. A public price-comparison page for cigarettes
// is not an obvious fit for any of those exceptions, and the exposure is entirely avoidable:
// a grocery basket optimiser has no reason to carry tobacco at all.
//
// So it is excluded STRUCTURALLY — at the pool, before matching, so it can never enter the
// catalog and can never be created by `addNew`. Excluding it at display time would leave the
// rows in the database, which is a worse place to discover a legal question from.
//
// This is a deliberately conservative list. False positives cost us a product; false negatives
// cost us a legal problem. Where a word is genuinely ambiguous in Romanian it is handled by
// requiring a longer form, and the traps are enumerated below because they are not obvious.

import { normalizeText } from "./matching";

export type ExclusionReason = "tobacco" | null;

/**
 * Tokens that mean tobacco or nicotine on their own.
 *
 * Matched against the NORMALIZED name (diacritics folded, lowercased) as whole words, so
 * `tigari` does not match inside a longer word.
 */
const TOBACCO_WORDS = [
  "tigara", "tigari", "tigarete", "tigareta",
  "tutun", "tutungerie",
  "trabuc", "trabucuri",
  "narghilea", "narghilele", "shisha",
  "snus", "nicotina", "nicotine",
  "vape", "vaping", "vapat",
  "iqos", "heets", "heat", "glo", "ploom", "veev", "lyft", "velo", "zyn",
  "puffmi", "elfbar", "elf",
];

/**
 * Phrases that only mean tobacco in combination.
 *
 * THE TRAPS, all real Romanian words that a naive list would eat:
 *   • `tigaie` / `tigai` — a FRYING PAN. One letter from `tigari` and a genuine grocery item.
 *     Whole-word matching handles it; substring matching would not, which is why this module
 *     tokenizes rather than calling `includes`.
 *   • `foi` — leaves/sheets. `foi de dafin` is bay leaf, `tigari de foi` is cigars. Only the
 *     phrase is excluded.
 *   • `rezerve` — refills. `rezerve de tutun` is tobacco; `rezerve odorizant` is an air
 *     freshener refill, and Mega Image sells far more of the latter.
 *   • `cartus` / `cartuse` — a cartridge. Printer, e-cigarette, or a carton of cigarettes.
 *     Only excluded next to a nicotine word.
 *   • `heat`, `glo`, `elf` — short brand names that collide with ordinary words, so they are
 *     required to appear with a second signal.
 */
const TOBACCO_PHRASES: [string, string][] = [
  ["tigari", "foi"],
  ["rezerve", "tutun"],
  ["rezerva", "tutun"],
  ["pliculete", "nicotina"],
  ["plicuri", "nicotina"],
  ["cartus", "nicotina"],
  ["cartuse", "nicotina"],
  ["tigara", "electronica"],
  ["dispozitiv", "incalzit"],
];

/** Short brand tokens that need a second signal before they mean tobacco. */
const AMBIGUOUS_BRANDS = new Set(["heat", "glo", "elf", "veev", "velo", "lyft"]);
const SECOND_SIGNAL = new Set([
  "tutun", "nicotina", "tigara", "tigari", "vape", "pod", "pods", "kit", "sticks", "stick",
]);

function words(name: string): string[] {
  return normalizeText(name).split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * Is this store product one we refuse to carry?
 *
 * Returns the reason so a caller can count and report it, rather than a bare boolean that
 * makes an exclusion indistinguishable from a parse failure.
 */
export function exclusionReason(name: string, brand?: string | null): ExclusionReason {
  const w = words(`${name} ${brand ?? ""}`);
  const set = new Set(w);

  for (const t of TOBACCO_WORDS) {
    if (!set.has(t)) continue;
    if (AMBIGUOUS_BRANDS.has(t)) {
      if (w.some((x) => SECOND_SIGNAL.has(x))) return "tobacco";
      continue;
    }
    return "tobacco";
  }
  for (const [a, b] of TOBACCO_PHRASES) {
    if (set.has(a) && set.has(b)) return "tobacco";
  }
  return null;
}

export function isExcluded(name: string, brand?: string | null): boolean {
  return exclusionReason(name, brand) !== null;
}
