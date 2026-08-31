"use client";
// Basket-inflation: snapshot the cheapest-split total once per day so we can show how the
// same basket's cost drifts over time. Fills in as the user revisits across days.

type Snap = Record<string, number>; // date -> total
const KEY = "cosmic_basket_snap";

export function snapshotBasket(total: number) {
  if (!(total > 0)) return;
  try {
    const s: Snap = JSON.parse(localStorage.getItem(KEY) || "{}");
    const day = new Date().toISOString().slice(0, 10);
    s[day] = total;
    // keep last ~120 days
    const days = Object.keys(s).sort();
    for (const d of days.slice(0, -120)) delete s[d];
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/** Compare today's total to the earliest recorded snapshot. */
export function basketTrend(total: number): { deltaPct: number; sinceDate: string } | null {
  try {
    const s: Snap = JSON.parse(localStorage.getItem(KEY) || "{}");
    const days = Object.keys(s).sort();
    if (days.length < 2) return null;
    const first = s[days[0]];
    if (!(first > 0) || !(total > 0)) return null;
    return { deltaPct: ((total - first) / first) * 100, sinceDate: days[0] };
  } catch {
    return null;
  }
}
