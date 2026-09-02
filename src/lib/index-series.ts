// Pricing the fixed basket, now and back through PriceHistory.
//
// Two rules run through everything here:
//
//   1. NEVER SUBSTITUTE. A basket line resolves to its pinned product or it resolves to nothing.
//      If a pin stops resolving, the line is MISSING and every total containing it is marked
//      incomplete. Quietly swapping in a similar product is what made the old index jump 26,8%
//      in three days.
//
//   2. NEVER INTERPOLATE. A day on which we did not observe a price for a line does not get a
//      neighbouring day's price. The day is incomplete and says so. An index is a claim about
//      what things cost; filling a hole invents an observation nobody made.
//
// Both mean the honest series is shorter and gappier than a smooth one. That is the point.

import { prisma } from "./db";
import { INDEX_BASKET, BASKET_VERSION, type BasketItem } from "./index-basket";

/** A price we are willing to put in the index: in stock, not withheld, not stale. */
const LIVE_OFFER = { availability: "in stock", flagged: false, isStale: false } as const;

export type BasketLine = {
  item: BasketItem;
  /** Cheapest price in lei across merchants, or null when the line could not be priced. */
  price: number | null;
  merchant: string | null;
  /** Null only when the pin no longer resolves at all — a different failure from "no price". */
  productName: string | null;
  found: boolean;
  /** Every merchant that currently prices this line, cheapest first. */
  byMerchant: { merchant: string; price: number }[];
};

export type BasketNow = {
  version: number;
  lines: BasketLine[];
  /** Sum of the priced lines. Meaningful only alongside `complete`. */
  total: number;
  priced: number;
  of: number;
  complete: boolean;
  missingPins: string[];
  computedAt: Date;
};

/** Price the basket from today's live offers. */
export async function priceBasketNow(): Promise<BasketNow> {
  const products = await prisma.product.findMany({
    where: { slug: { in: INDEX_BASKET.map((i) => i.slug) } },
    select: {
      slug: true, name: true,
      offers: {
        where: LIVE_OFFER,
        select: { price: true, merchant: { select: { name: true, slug: true } } },
      },
    },
  });
  const bySlug = new Map(products.map((p) => [p.slug, p]));

  const lines: BasketLine[] = INDEX_BASKET.map((item) => {
    const p = bySlug.get(item.slug);
    if (!p) {
      return { item, price: null, merchant: null, productName: null, found: false, byMerchant: [] };
    }
    const byMerchant = p.offers
      .filter((o) => o.price > 0)
      .map((o) => ({ merchant: o.merchant.name, price: o.price }))
      .sort((a, b) => a.price - b.price);
    return {
      item,
      price: byMerchant.length ? byMerchant[0].price : null,
      merchant: byMerchant.length ? byMerchant[0].merchant : null,
      productName: p.name,
      found: true,
      byMerchant,
    };
  });

  const priced = lines.filter((l) => l.price != null).length;
  return {
    version: BASKET_VERSION,
    lines,
    total: lines.reduce((s, l) => s + (l.price ?? 0), 0),
    priced,
    of: lines.length,
    complete: priced === lines.length,
    missingPins: lines.filter((l) => !l.found).map((l) => l.item.slug),
    computedAt: new Date(),
  };
}

export type SeriesPoint = {
  /** YYYY-MM-DD */
  day: string;
  /** Sum of the priced lines that day. */
  total: number;
  priced: number;
  of: number;
  complete: boolean;
  /** Cheapest total achievable within ONE merchant, for merchants that priced every line. */
  byMerchant: { merchant: string; total: number; priced: number; complete: boolean }[];
};

/**
 * Rebuild the basket's cost for every day on which we have observations.
 *
 * PriceHistory appends on CHANGE only, so a line's price on a given day is the most recent
 * observation at or before that day — a price that did not change was still the price. That is
 * carrying a KNOWN value forward, not interpolating between two unknowns: we observed it, and
 * nothing since has contradicted it.
 *
 * A line with no observation at or before the day is genuinely unknown and leaves the day
 * incomplete. We do NOT reach backwards past the first observation.
 */
export async function basketSeries(): Promise<{ points: SeriesPoint[]; firstObserved: string | null; lastObserved: string | null }> {
  const products = await prisma.product.findMany({
    where: { slug: { in: INDEX_BASKET.map((i) => i.slug) } },
    select: {
      slug: true,
      offers: {
        select: {
          id: true,
          merchant: { select: { name: true } },
          history: { select: { price: true, recordedAt: true }, orderBy: { recordedAt: "asc" } },
        },
      },
    },
  });

  // (day, key, merchant) -> price, built by walking each offer's own observations forward.
  type Obs = { day: string; key: string; merchant: string; price: number };
  const obs: Obs[] = [];
  const slugToKey = new Map(INDEX_BASKET.map((i) => [i.slug, i.key]));
  const days = new Set<string>();

  for (const p of products) {
    const key = slugToKey.get(p.slug);
    if (!key) continue;
    for (const o of p.offers) {
      for (const h of o.history) {
        if (!(h.price > 0)) continue;
        const day = h.recordedAt.toISOString().slice(0, 10);
        days.add(day);
        obs.push({ day, key, merchant: o.merchant.name, price: h.price });
      }
    }
  }

  const allDays = [...days].sort();
  if (allDays.length === 0) return { points: [], firstObserved: null, lastObserved: null };

  // Observations per basket line, per merchant, sorted by day, so "latest at or before D" is a
  // scan. NESTED MAPS rather than a joined "key|merchant" string: a composite string key needs a
  // separator that cannot occur in either half, and merchant names are free text. Nesting has no
  // separator to get wrong.
  const byLine = new Map<string, Map<string, { day: string; price: number }[]>>();
  for (const o of obs) {
    let perMerchant = byLine.get(o.key);
    if (!perMerchant) { perMerchant = new Map(); byLine.set(o.key, perMerchant); }
    let arr = perMerchant.get(o.merchant);
    if (!arr) { arr = []; perMerchant.set(o.merchant, arr); }
    arr.push({ day: o.day, price: o.price });
  }
  for (const perMerchant of byLine.values()) {
    for (const arr of perMerchant.values()) arr.sort((a, b) => (a.day < b.day ? -1 : 1));
  }

  const merchants = [...new Set(obs.map((o) => o.merchant))];
  const points: SeriesPoint[] = [];

  for (const day of allDays) {
    // Cheapest known price per line on this day, across merchants.
    const cheapest = new Map<string, number>();
    const perMerchant = new Map<string, Map<string, number>>();

    for (const item of INDEX_BASKET) {
      for (const m of merchants) {
        const arr = byLine.get(item.key)?.get(m);
        if (!arr) continue;
        // latest observation at or before `day`; null if the first one is later
        let val: number | null = null;
        for (const e of arr) {
          if (e.day <= day) val = e.price;
          else break;
        }
        if (val == null) continue;
        if (!perMerchant.has(m)) perMerchant.set(m, new Map());
        perMerchant.get(m)!.set(item.key, val);
        const cur = cheapest.get(item.key);
        if (cur == null || val < cur) cheapest.set(item.key, val);
      }
    }

    const priced = cheapest.size;
    points.push({
      day,
      total: [...cheapest.values()].reduce((a, b) => a + b, 0),
      priced,
      of: INDEX_BASKET.length,
      complete: priced === INDEX_BASKET.length,
      byMerchant: [...perMerchant.entries()]
        .map(([merchant, m]) => ({
          merchant,
          total: [...m.values()].reduce((a, b) => a + b, 0),
          priced: m.size,
          complete: m.size === INDEX_BASKET.length,
        }))
        .sort((a, b) => b.priced - a.priced || a.total - b.total),
    });
  }

  return { points, firstObserved: allDays[0], lastObserved: allDays[allDays.length - 1] };
}

export type Change = { pct: number; from: string; to: string } | null;

/**
 * Percentage change between two points of EQUAL COMPOSITION.
 *
 * Comparing a 40-line total against a 37-line total measures the three missing lines, not a
 * price movement — so a comparison is refused unless both ends priced the same set. This is the
 * same rule as the pin: only like against like.
 */
export function changeBetween(a: SeriesPoint | undefined, b: SeriesPoint | undefined): Change {
  if (!a || !b || a.priced !== b.priced || a.priced === 0 || a.total <= 0) return null;
  return { pct: ((b.total - a.total) / a.total) * 100, from: a.day, to: b.day };
}

/** Month-over-month and year-over-year, when the series is long enough to support them. */
export function periodChanges(points: SeriesPoint[]): { month: Change; year: Change; spanDays: number } {
  if (points.length === 0) return { month: null, year: null, spanDays: 0 };
  const last = points[points.length - 1];
  const spanDays = Math.round(
    (Date.parse(last.day + "T00:00:00Z") - Date.parse(points[0].day + "T00:00:00Z")) / 86_400_000,
  );
  const at = (daysAgo: number): SeriesPoint | undefined => {
    const target = new Date(Date.parse(last.day + "T00:00:00Z") - daysAgo * 86_400_000)
      .toISOString().slice(0, 10);
    // The newest point at or before the target; undefined when the series does not reach back.
    let found: SeriesPoint | undefined;
    for (const p of points) if (p.day <= target) found = p; else break;
    return found;
  };
  return { month: changeBetween(at(28), last), year: changeBetween(at(365), last), spanDays };
}
