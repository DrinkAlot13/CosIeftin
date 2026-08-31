"use client";
// Client-side price trackers (localStorage). Track a product with an optional target
// price; an alert "fires" when the current lowest price is at/below the target, or (no
// target) drops below the price when you started tracking. Server-side persistence +
// email/push is the upgrade path; this in-app inbox needs no external setup.

export type Alert = { slug: string; name: string; target: number | null; base: number };

const KEY = "cosmic_alerts";
export const ALERT_EVENT = "cosmic-alerts";

export function getAlerts(): Alert[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function save(a: Alert[]) {
  localStorage.setItem(KEY, JSON.stringify(a));
  window.dispatchEvent(new Event(ALERT_EVENT));
}

export function isTracked(slug: string): boolean {
  return getAlerts().some((a) => a.slug === slug);
}

export function addAlert(a: Alert) {
  const list = getAlerts();
  if (list.some((x) => x.slug === a.slug)) return;
  save([...list, a]);
}

export function removeAlert(slug: string) {
  save(getAlerts().filter((a) => a.slug !== slug));
}

export function setTarget(slug: string, target: number | null) {
  save(getAlerts().map((a) => (a.slug === slug ? { ...a, target } : a)));
}

/** Fired = current lowest at/under target, or (no target) below the tracked baseline. */
export function isFired(a: Alert, current: number | undefined): boolean {
  if (current == null || current <= 0) return false;
  if (a.target != null) return current <= a.target + 1e-9;
  return current < a.base - 1e-9;
}
