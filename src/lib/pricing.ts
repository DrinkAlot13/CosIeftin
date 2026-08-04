export type OfferLike = { price: number; availability: string };

export type PriceSummary = {
  lowest: number;
  highest: number;
  savings: number;
  offerCount: number;
  inStockCount: number;
};

/** Reduce an item's offers to the headline numbers users compare. */
export function summarize(offers: OfferLike[]): PriceSummary {
  if (offers.length === 0) {
    return { lowest: 0, highest: 0, savings: 0, offerCount: 0, inStockCount: 0 };
  }
  const inStock = offers.filter((o) => o.availability === "in stock");
  const pool = inStock.length > 0 ? inStock : offers;
  const lowest = Math.min(...pool.map((o) => o.price));
  const highest = Math.max(...offers.map((o) => o.price));
  return {
    lowest,
    highest,
    savings: Math.max(0, highest - lowest),
    offerCount: offers.length,
    inStockCount: inStock.length,
  };
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
