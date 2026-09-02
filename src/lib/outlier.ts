// ONE definition of "this price is an outlier", used by the audit that reports it and by the
// script that acts on it.
//
// There were two. `audit-db` used `|b - med| > 0.7 * med` over every offer it had loaded;
// the repair script used `b > 1.7*med || b < med/1.7` over showable offers only. Two
// thresholds AND two populations, so the audit said 47 and the repair found 7, and the gap
// looked like a bug in one of them rather than a disagreement between them.
//
// That is the `priceSource` shape exactly: one rule, two spellings, nothing to say which was
// right. The fix is the same — put the rule in one place and make both callers import it.
//
// THE TWO THRESHOLDS ARE NOT INTERCHANGEABLE, which is why the disagreement mattered:
//
//   |b - med| > 0.7*med   →  b > 1.70*med  or  b < 0.30*med
//   b > 1.7*med || b < med/1.7  →  b > 1.70*med  or  b < 0.588*med
//
// They agree on the high side and differ by a factor of two on the low side. A product priced
// at 40% of its peers is an outlier under one and invisible under the other.
//
// The absolute form is kept: "more than 70% away from the median" is what CLAUDE.md states,
// and a symmetric band in RATIO terms would need the reciprocal (1/1.7 = 0.588), which reads
// as 41% and is not what the rule says.

/** How far from the cross-store median a price may sit. CLAUDE.md: 70%. */
export const MEDIAN_DEVIATION = 0.7;

/** A median of two is not a median. */
export const MIN_OFFERS_FOR_MEDIAN = 3;

export type OfferForOutlier = {
  id: number;
  price: number;
  priceBani: number | null;
  flagged: boolean;
  isStale: boolean;
  availability: string;
};

export const baniOf = (o: OfferForOutlier): number => o.priceBani ?? Math.round(o.price * 100);

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Is this price more than MEDIAN_DEVIATION away from `med`?
 *
 * Absolute, symmetric in the value: `|b - med| > 0.7 * med`.
 */
export function isOutlier(bani: number, med: number): boolean {
  if (med <= 0) return false;
  return Math.abs(bani - med) > med * MEDIAN_DEVIATION;
}

/**
 * THE POPULATION. Only offers a shopper can actually see.
 *
 * An unflagged outlier is a USER-FACING defect — a wrong price on a live page — so the
 * population is what reaches a page. A withheld or stale row cannot mislead anyone, and
 * counting it makes the audit report a defect the site does not have.
 *
 * Data-integrity audits use a different population and say so; see `audit-db`'s header.
 */
export function isVisible(o: OfferForOutlier): boolean {
  return !o.flagged && !o.isStale && o.availability === "in stock" && baniOf(o) > 0;
}

export type Outlier<T extends OfferForOutlier> = { offer: T; medianBani: number; peers: number };

/**
 * Every visible outlier across a set of products.
 *
 * The median is computed over the VISIBLE offers only. Including withheld ones would let a
 * price we have already refused drag the median toward itself and hide the next one.
 */
export function findOutliers<T extends OfferForOutlier>(
  byProduct: Map<number, T[]>,
): Outlier<T>[] {
  const out: Outlier<T>[] = [];
  for (const [, all] of byProduct) {
    const visible = all.filter(isVisible);
    if (visible.length < MIN_OFFERS_FOR_MEDIAN) continue;
    const med = median(visible.map(baniOf));
    if (med <= 0) continue;
    for (const o of visible) {
      if (isOutlier(baniOf(o), med)) out.push({ offer: o, medianBani: med, peers: visible.length });
    }
  }
  return out;
}

// ── THE GROUP, NOT THE CULPRIT ────────────────────────────────────────────────────────────
//
// See CLAUDE.md → "A peer-relative check flags disagreement, not guilt". `findOutliers` above
// names a row, which is exactly the shape that misleads: it can only ever mean "this row
// disagrees with the median", and when false matches cluster the median is theirs, not the
// product's. Everything user-visible about a disagreement should be reported as a GROUP.

/** A store product's own name, for spotting a group whose members are not the same product. */
export type NamedOffer = OfferForOutlier & {
  storeName?: string | null;
  merchantName?: string;
};

const NAME_NOISE = new Set(["de", "cu", "la", "si", "din", "fara", "pentru", "sau", "un", "o"]);

/**
 * Word-order-independent token bag of a store name.
 *
 * Word order is not information here: "Somon file afumat" and "File de somon afumat" are the
 * same product written twice. What IS information is a token one side has and the other lacks
 * — "foi" (sheets) against nothing, "CARNE SI SARE" against nothing.
 */
export function nameBag(s: string | null | undefined): string {
  if (!s) return "";
  return [...new Set(
    s.toLowerCase()
      .split("ș").join("s").split("ş").join("s").split("ț").join("t").split("ţ").join("t")
      .split("ă").join("a").split("â").join("a").split("î").join("i")
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((t) => t && !NAME_NOISE.has(t)),
  )].sort().join(" ");
}

export type DisagreeingGroup<T extends NamedOffer> = {
  productId: number;
  productName: string;
  medianBani: number;
  offers: T[];
  /** How many DISTINCT store-name token bags the group contains. >1 suggests a mismatch. */
  distinctNames: number;
  /** Offers whose price sits outside the band — reported as members, never as the answer. */
  disagreeing: T[];
  /** True when at least one member carries no store name, so the group cannot be judged on names. */
  hasUnnamed: boolean;
};

/**
 * Groups whose prices disagree, described rather than adjudicated.
 *
 * Returns the WHOLE group every time, so a caller cannot print "offer X is an outlier" without
 * also having the rows that would contradict it.
 */
export function findDisagreeingGroups<T extends NamedOffer>(
  byProduct: Map<number, { name: string; offers: T[] }>,
): DisagreeingGroup<T>[] {
  const out: DisagreeingGroup<T>[] = [];
  for (const [productId, { name, offers }] of byProduct) {
    const visible = offers.filter(isVisible);
    if (visible.length < MIN_OFFERS_FOR_MEDIAN) continue;
    const med = median(visible.map(baniOf));
    if (med <= 0) continue;
    const disagreeing = visible.filter((o) => isOutlier(baniOf(o), med));
    if (disagreeing.length === 0) continue;
    const bags = new Set(visible.map((o) => nameBag(o.storeName)).filter(Boolean));
    out.push({
      productId, productName: name, medianBani: med, offers: visible,
      distinctNames: bags.size,
      disagreeing,
      hasUnnamed: visible.some((o) => !o.storeName),
    });
  }
  return out;
}

/**
 * Tokens that only SOME members of the group carry.
 *
 * The count of distinct names is nearly useless on its own — "Physalis caserola 100 g" and
 * "Physalis 100g" differ, and mean the same thing. What discriminates is the token one side has
 * and the other lacks: `foi` (sheets, against powder), `carne si sare` (a brand, against an
 * own-label). That is the union minus the intersection, and it is what to read.
 */
export function discriminatingTokens(g: DisagreeingGroup<NamedOffer>): string[] {
  // SIZE IS NOT A NAME TOKEN. "100 g", "100g" and "100" tokenise three ways and mean one
  // thing, so leaving them in reports `100, 100g, g` as if it were evidence and buries the
  // token that is — `caserola`, `foi`, `oetker`. Size disagreement is checked explicitly and
  // numerically elsewhere; this function answers the different question of whether the WORDS
  // describe the same product.
  const isSize = (t: string): boolean => /^\d+(?:[.,]\d+)?(?:g|kg|ml|l|cl|buc|gr)?$/.test(t) || /^(?:g|kg|ml|l|cl|buc|gr)$/.test(t);
  const bags = g.offers
    .map((o) => new Set(nameBag(o.storeName).split(" ").filter((t) => t && !isSize(t))))
    .filter((b) => b.size > 0);
  if (bags.length < 2) return [];
  const union = new Set<string>();
  for (const b of bags) for (const t of b) union.add(t);
  return [...union].filter((t) => !bags.every((b) => b.has(t))).sort();
}

/** One line saying what the group's names imply, in the audit's own words. */
export function nameVerdict(g: DisagreeingGroup<NamedOffer>): string {
  if (g.hasUnnamed) return "a row has NO store name — cannot be judged on names";
  const diff = discriminatingTokens(g);
  if (diff.length === 0) return "every row has the same store-name tokens — a genuine price disagreement";
  return `not all rows carry: ${diff.slice(0, 8).join(", ")}${diff.length > 8 ? ` (+${diff.length - 8})` : ""} — CHECK FOR A MISMATCH first`;
}
