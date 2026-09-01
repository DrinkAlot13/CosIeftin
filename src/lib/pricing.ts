export type OfferLike = {
  price: number;
  priceBani?: number | null;
  availability: string;
  /** when this offer was last actually OBSERVED in a feed */
  lastSeen?: Date | null;
  isStale?: boolean | null;
};

/**
 * Past this, a price is not a current price, whatever the page says.
 *
 * Three offers last seen on 6 August were shown as current 26 days later, one badged
 * "cel mai mic preț", at 10,49 against a real 10,75 and 17,99 against a real 24,99. Those were
 * not parse errors — they were correct prices, a month ago, and nothing stopped them being
 * presented as today's.
 */
export const MAX_DISPLAY_AGE_DAYS = 14;

/**
 * May this offer set the headline price and count toward "N magazine"?
 *
 * Enforced HERE, in the layer every page shares, rather than in a component — a rule that lives
 * in one card is a rule the next card does not have. An offer that fails this is still SHOWN,
 * greyed and dated; it just cannot be the number we stand behind.
 */
export function isCurrent(o: OfferLike, now: Date = new Date()): boolean {
  if (o.availability !== "in stock") return false;
  if (o.isStale) return false;
  if (!o.lastSeen) return true; // no observation date recorded: do not punish it
  return (now.getTime() - o.lastSeen.getTime()) / 86_400_000 <= MAX_DISPLAY_AGE_DAYS;
}

export type PriceSummary = {
  /** AUTHORITATIVE. Integer bani — what comparisons and sorting use. */
  lowestBani: number;
  highestBani: number;
  savingsBani: number;
  /** Derived from the bani figures for display. Never compared against. */
  lowest: number;
  highest: number;
  savings: number;
  /** merchants we can stand behind — current, in stock. This is the "N magazine" number. */
  offerCount: number;
  inStockCount: number;
  /** offers held back from the headline: stale, old or out of stock. Shown greyed, not counted. */
  staleCount: number;
  /** false when nothing is current — the page must then show no headline price at all */
  hasCurrentPrice: boolean;
};

/**
 * Reduce an item's offers to the headline numbers users compare.
 *
 * Comparison happens in BANI. Every sort in the app runs through `summary.lowest`, and until
 * now that was `Math.min(...pool.map((o) => o.price))` — the legacy float. That is what left
 * the integer column exercised by nothing a shopper could touch, which is how it drifted into
 * 553 nulls and 614 wrong values without a single symptom.
 *
 * The lei figures are still returned, because that is what the UI renders, but they are DERIVED
 * from the bani ones and nothing compares them.
 */
export function summarize(offers: OfferLike[], now: Date = new Date()): PriceSummary {
  if (offers.length === 0) {
    return { lowestBani: 0, highestBani: 0, savingsBani: 0, lowest: 0, highest: 0, savings: 0, offerCount: 0, inStockCount: 0, staleCount: 0, hasCurrentPrice: false };
  }
  // ONLY current offers may set the headline. The old code fell back to the full set when
  // nothing was in stock — which is how an out-of-stock, month-old price won "cel mai mic preț"
  // on 8,633 product pages.
  const current = offers.filter((o) => isCurrent(o, now));
  if (current.length === 0) {
    // Nothing we can stand behind. Report zero rather than the cheapest thing we happen to hold.
    return {
      lowestBani: 0, highestBani: 0, savingsBani: 0, lowest: 0, highest: 0, savings: 0,
      offerCount: 0, inStockCount: 0, staleCount: offers.length, hasCurrentPrice: false,
    };
  }
  const lowestBani = Math.min(...current.map(bani));
  const highestBani = Math.max(...current.map(bani));
  const savingsBani = Math.max(0, highestBani - lowestBani);
  return {
    lowestBani,
    highestBani,
    savingsBani,
    lowest: lowestBani / 100,
    highest: highestBani / 100,
    savings: savingsBani / 100,
    // The merchant count counts merchants a shopper could buy from TODAY.
    offerCount: current.length,
    inStockCount: current.length,
    staleCount: offers.length - current.length,
    hasCurrentPrice: true,
  };
}

/**
 * An offer's price in bani.
 *
 * The float fallback is dead code while the audit invariant "no live offer has a null
 * priceBani" holds. It stays only so that a STALE row with a null cannot throw on a page that
 * happens to load it — it is a guard, not a source of truth, and it must never become the
 * reason a drift goes unnoticed again.
 */
function bani(o: OfferLike): number {
  return o.priceBani ?? Math.round(o.price * 100);
}

/** lei per base unit (kg / L / buc) — the fair-comparison number across pack sizes. */
export function pricePerUnit(price: number, unitSize: number): number {
  return unitSize > 0 ? price / unitSize : price;
}

export type PricePoint = { date: string; price: number };

/** Item's lowest price per day across all its offers — powers the chart. */
export function buildDailyLowSeries(
  offers: { history: { price: number; recordedAt: Date }[] }[],
): PricePoint[] {
  const byDay = new Map<string, number>();
  for (const o of offers) {
    for (const h of o.history) {
      const key = h.recordedAt.toISOString().slice(0, 10);
      const cur = byDay.get(key);
      if (cur === undefined || h.price < cur) byDay.set(key, h.price);
    }
  }
  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, price]) => ({ date, price }));
}

/** % the current lowest is below the highest daily-low in the window (a "drop"). */
export function dropPercent(series: PricePoint[]): number {
  if (series.length < 2) return 0;
  const current = series[series.length - 1].price;
  const peak = Math.max(...series.map((p) => p.price));
  if (peak <= 0) return 0;
  return ((peak - current) / peak) * 100;
}
