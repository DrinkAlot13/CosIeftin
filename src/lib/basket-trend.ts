"use client";
// Basket-inflation: snapshot the cheapest-split total once per day so we can show how the
// same basket's cost drifts over time. Fills in as the user revisits across days.

type Snap = Record<string, number>; // date -> total
const KEY = "cosmic_basket_snap";

// 370 rather than 120: a "vs a year ago" comparison needs a year of snapshots kept, and this is
// one localStorage key holding one number per day — a year of retention costs nothing.
const RETAIN_DAYS = 370;

export function snapshotBasket(total: number) {
  if (!(total > 0)) return;
  try {
    const s: Snap = JSON.parse(localStorage.getItem(KEY) || "{}");
    const day = new Date().toISOString().slice(0, 10);
    s[day] = total;
    const days = Object.keys(s).sort();
    for (const d of days.slice(0, -RETAIN_DAYS)) delete s[d];
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

/**
 * The same comparison at three fixed windows — a week, a month, a year ago — rather than only
 * "since the first time we ever saw this list". A shopper who has used the list for six months
 * cannot tell "up 40% since forever" apart from "up 2% this week, up 40% since March"; those are
 * different facts. Each window is honestly absent (not zero, not guessed) until a snapshot from
 * that far back actually exists — the nearest snapshot AT OR BEFORE the target day, so a daily
 * gap in usage does not silently disqualify the whole window.
 */
export function basketTrendWindows(total: number): { label: string; deltaPct: number; sinceDate: string }[] {
  if (!(total > 0)) return [];
  let s: Snap;
  try {
    s = JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return [];
  }
  const days = Object.keys(s).sort();
  if (days.length < 2) return [];

  const windows: { label: string; daysAgo: number }[] = [
    { label: "o săptămână", daysAgo: 7 },
    { label: "o lună", daysAgo: 30 },
    { label: "un an", daysAgo: 365 },
  ];
  const out: { label: string; deltaPct: number; sinceDate: string }[] = [];
  for (const w of windows) {
    const targetDay = new Date(Date.now() - w.daysAgo * 86_400_000).toISOString().slice(0, 10);
    // Nearest snapshot at or BEFORE the target — never one that is more recent than intended,
    // since "closest available" can only mean "closest in the past" without overstating recency.
    const match = [...days].reverse().find((d) => d <= targetDay);
    if (!match) continue;
    const base = s[match];
    if (!(base > 0)) continue;
    out.push({ label: w.label, deltaPct: ((total - base) / base) * 100, sinceDate: match });
  }
  return out;
}
