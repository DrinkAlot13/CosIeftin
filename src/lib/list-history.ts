"use client";
// A real version history of a list's CONTENTS, not just its total (basket-trend.ts already
// tracks the total). Captures the active cart's actual items once per calendar day, so "what was
// in this list a month ago" is answerable, not just "what did it cost".
import type { CartItem } from "./carts";

type Snapshot = { day: string; cartId: string; cartName: string; items: CartItem[] };
const KEY = "cosmic_list_history";
const RETAIN_DAYS = 90;

function load(): Snapshot[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Record today's version of this cart, replacing any snapshot already taken today for it. */
export function recordListVersion(cartId: string, cartName: string, items: CartItem[]) {
  if (items.length === 0) return;
  try {
    const day = new Date().toISOString().slice(0, 10);
    const all = load().filter((s) => !(s.cartId === cartId && s.day === day));
    all.push({ day, cartId, cartName, items: items.map((i) => ({ ...i })) });
    all.sort((a, b) => a.day.localeCompare(b.day));
    const cutoffDay = new Date(Date.now() - RETAIN_DAYS * 86_400_000).toISOString().slice(0, 10);
    const trimmed = all.filter((s) => s.day >= cutoffDay);
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    /* ignore */
  }
}

/** Past versions of one cart, newest first, excluding today (today is just the live list). */
export function listVersions(cartId: string): Snapshot[] {
  const today = new Date().toISOString().slice(0, 10);
  return load()
    .filter((s) => s.cartId === cartId && s.day !== today)
    .sort((a, b) => b.day.localeCompare(a.day));
}
