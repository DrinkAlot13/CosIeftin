// ── "IS THIS A GOOD PRICE?" — ANSWERED FROM OUR OWN OBSERVATIONS, OR NOT ANSWERED.
//
// 116,827 `PriceHistory` rows existed and no product page used them. This turns them into the one
// question a shopper on a single-shop product can still have answered — which matters more than
// comparability, because 89% of priced products have exactly one shop.
//
// ── THE WINDOW IS MEASURED, NOT NAMED. THIS IS THE WHOLE DESIGN.
//
// The brief asked for "cel mai mic preț din ultimele 30 / 90 de zile". **We have 35 days of
// history — it began 2026-08-06.** A "90-day low" computed from 35 days of data is a number that
// is wrong in a way the reader cannot see, and it would have to be retracted the first time
// somebody checked. So no window is ever named that the data does not cover: the label states the
// span we actually observed, for THIS product, in weeks.
//
// ── `PriceHistory` APPENDS ON CHANGE ONLY, WHICH MAKES ONE ROW MEANINGFUL.
//
// CLAUDE.md: rows are written on CHANGE, not nightly. So a product with a single row is not a
// product with no data — it is a product **whose price has not moved since we first saw it**.
// That is worth saying, and 58% of live grocery products are in exactly that state. Reading one
// row as "no data" would throw away the most common true statement we can make.
//
// ── WHAT IS REFUSED.
//
//   · No interpolation. A gap between observations is a gap; the chart draws a break and this
//     module never invents a value to fill one.
//   · Only OUR observations. A retailer's Omnibus 30-day figure is carried separately and
//     labelled as theirs. **No discount claim is computed from it** — that gate is still NO.
//   · Under 14 days of span says so, rather than showing a trend that means nothing.
//   · "Un moment bun" is stated with its rule attached, never as a bare verdict.

export const MIN_DAYS_FOR_A_CLAIM = 14;
export const MIN_POINTS_FOR_A_TREND = 3;
/** How close to the observed low still counts as "at the low". */
export const AT_LOW_TOLERANCE = 0.02;

export type Observation = { priceBani: number; at: Date };

export type PriceStory =
  | { kind: "no-price" }
  /** We have watched it, but not long enough to say anything about the price. */
  | { kind: "too-new"; observedDays: number; points: number }
  /** One observation, and history is change-only, so: the price has not moved. */
  | { kind: "unchanged"; observedDays: number; currentBani: number }
  | {
      kind: "story";
      observedDays: number;
      points: number;
      currentBani: number;
      lowBani: number;
      lowAt: Date;
      highBani: number;
      highAt: Date;
      /** How far above the observed low the current price sits, as a fraction. 0 when at it. */
      pctAboveLow: number;
      atLow: boolean;
      /** True only when the rule below is satisfied; the rule is shown to the reader. */
      goodTime: boolean;
      canDrawTrend: boolean;
    };

/** Whole days between the first observation and now. */
export function observedDaysOf(obs: Observation[], now = new Date()): number {
  if (obs.length === 0) return 0;
  const first = Math.min(...obs.map((o) => +o.at));
  return Math.max(0, Math.floor((+now - first) / 86_400_000));
}

/**
 * Build the story for one product from every observation across its offers.
 *
 * `currentBani` is passed in rather than taken as the last observation: the current price is what
 * the offer row says today, and the last history row is what it said when it last CHANGED. Those
 * are the same number in a healthy catalog and they are not the same fact.
 */
export function priceStory(
  currentBani: number | null | undefined,
  obs: Observation[],
  now = new Date(),
): PriceStory {
  if (currentBani == null || currentBani <= 0) return { kind: "no-price" };

  const clean = obs.filter((o) => Number.isFinite(o.priceBani) && o.priceBani > 0);
  const observedDays = observedDaysOf(clean, now);
  const points = clean.length;

  if (points === 0) return { kind: "too-new", observedDays: 0, points: 0 };

  // Change-only history: one row means the price has never moved since we first saw it. Said
  // plainly, and only once we have watched long enough for it to be worth saying.
  if (points === 1) {
    return observedDays >= MIN_DAYS_FOR_A_CLAIM
      ? { kind: "unchanged", observedDays, currentBani }
      : { kind: "too-new", observedDays, points };
  }

  if (observedDays < MIN_DAYS_FOR_A_CLAIM) return { kind: "too-new", observedDays, points };

  let low = clean[0];
  let high = clean[0];
  for (const o of clean) {
    if (o.priceBani < low.priceBani) low = o;
    if (o.priceBani > high.priceBani) high = o;
  }

  const pctAboveLow = low.priceBani > 0 ? (currentBani - low.priceBani) / low.priceBani : 0;
  const atLow = pctAboveLow <= AT_LOW_TOLERANCE;

  return {
    kind: "story",
    observedDays,
    points,
    currentBani,
    lowBani: low.priceBani,
    lowAt: low.at,
    highBani: high.priceBani,
    highAt: high.at,
    pctAboveLow,
    atLow,
    // THE RULE, and it is deliberately narrow. Being at the low of five weeks is a weak claim,
    // so it is only made when the price has actually MOVED (3+ observations) over a period long
    // enough to mean something. Otherwise "un moment bun" would appear on every product whose
    // price simply never changed.
    goodTime: atLow && points >= MIN_POINTS_FOR_A_TREND && observedDays >= MIN_DAYS_FOR_A_CLAIM && high.priceBani > low.priceBani,
    canDrawTrend: points >= MIN_POINTS_FOR_A_TREND,
  };
}

/**
 * "de 5 săptămâni" / "de 12 zile" — the span we ACTUALLY watched, never a nominal window.
 *
 * Romanian plural rules: 1 = singular, 2-19 = plain plural, 20+ = "de" + plural.
 */
export function spanLabelRo(days: number): string {
  if (days < 14) return days === 1 ? "de o zi" : `de ${days} zile`;
  const weeks = Math.floor(days / 7);
  return weeks === 1 ? "de o săptămână" : `de ${weeks} săptămâni`;
}

/** "cu 12% peste minimul perioadei" — only ever about our own observations. */
export function aboveLowLabelRo(pctAboveLow: number): string {
  const pct = Math.round(pctAboveLow * 100);
  if (pct <= 0) return "cel mai mic preț observat";
  return `cu ${pct}% peste minimul observat`;
}

export function formatDayRo(d: Date): string {
  return d.toLocaleDateString("ro-RO", { day: "numeric", month: "long" });
}
