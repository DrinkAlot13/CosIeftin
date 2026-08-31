export type OfferLike = { price: number; priceBani?: number | null; availability: string };

export type PriceSummary = {
  /** AUTHORITATIVE. Integer bani — what comparisons and sorting use. */
  lowestBani: number;
  highestBani: number;
  savingsBani: number;
  /** Derived from the bani figures for display. Never compared against. */
  lowest: number;
  highest: number;
  savings: number;
  offerCount: number;
  inStockCount: number;
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
export function summarize(offers: OfferLike[]): PriceSummary {
  if (offers.length === 0) {
    return { lowestBani: 0, highestBani: 0, savingsBani: 0, lowest: 0, highest: 0, savings: 0, offerCount: 0, inStockCount: 0 };
  }
  const inStock = offers.filter((o) => o.availability === "in stock");
  const pool = inStock.length > 0 ? inStock : offers;
  const lowestBani = Math.min(...pool.map(bani));
  const highestBani = Math.max(...offers.map(bani));
  const savingsBani = Math.max(0, highestBani - lowestBani);
  return {
    lowestBani,
    highestBani,
    savingsBani,
    lowest: lowestBani / 100,
    highest: highestBani / 100,
    savings: savingsBani / 100,
    offerCount: offers.length,
    inStockCount: inStock.length,
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
