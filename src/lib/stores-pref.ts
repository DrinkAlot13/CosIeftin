"use client";
// Client-side "my stores" preference (localStorage). Users pick the chains near them so
// the basket highlights those totals. Empty set = no preference (show all).

const KEY = "cosmic_pref_stores";
export const PREF_EVENT = "cosmic-pref-stores";

export function getPreferred(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function isPreferred(slug: string): boolean {
  return getPreferred().includes(slug);
}

export function togglePreferred(slug: string) {
  const cur = new Set(getPreferred());
  if (cur.has(slug)) cur.delete(slug);
  else cur.add(slug);
  localStorage.setItem(KEY, JSON.stringify([...cur]));
  window.dispatchEvent(new Event(PREF_EVENT));
}
