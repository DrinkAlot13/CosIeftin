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
