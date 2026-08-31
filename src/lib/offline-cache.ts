// Last-known-good basket, for the aisle.
//
// The whole point of this app is to be used IN A SHOP, which is exactly where signal is worst.
// Until now, offline meant `/api/basket` failed, `setResult` never ran, and the shopper stood
// in front of the shelf looking at an empty panel. The service worker made the PAGE load
// offline; it did nothing for the only thing on the page anybody needs.
//
// The old reasoning — "a stale basket total would be worse than an error" — is right about
// stale money and wrong about the shopper. A total from 20 minutes ago, LABELLED as being from
// 20 minutes ago, is enormously more useful than nothing. A total from three weeks ago is not,
// however it is labelled, so it is not served at all.
//
// Two rules keep it honest:
//   1. A cached result is served ONLY for the exact same list. A different list must never see
//      another list's totals, and the items key is what guarantees it.
//   2. The age always comes back with the data. There is no way to read a cached total without
//      also being handed how old it is, so the UI cannot fail to say so.

export type CachedBasket<T> = {
  /** the exact list this was computed for — a different list must never read it */
  itemsKey: string;
  savedAt: number;
  result: T;
};

/** Past this, a price is misleading no matter how it is labelled. */
export const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const KEY = "cosmic_basket_cache_v1";

export type Freshness = {
  ageMs: number;
  /** Romanian, for the banner: "acum 20 de minute" */
  label: string;
  /** true past MAX_CACHE_AGE_MS — such a result is not returned at all */
  tooOld: boolean;
};

export function describeAge(ageMs: number, now = Date.now()): Freshness {
  void now;
  const min = Math.floor(ageMs / 60000);
  const hours = Math.floor(min / 60);
  const days = Math.floor(hours / 24);
  let label: string;
  if (min < 1) label = "acum câteva secunde";
  else if (min === 1) label = "acum un minut";
  else if (min < 60) label = `acum ${min} de minute`;
  else if (hours === 1) label = "acum o oră";
  else if (hours < 24) label = `acum ${hours} ore`;
  else if (days === 1) label = "ieri";
  else label = `acum ${days} zile`;
  return { ageMs, label, tooOld: ageMs > MAX_CACHE_AGE_MS };
}

/** Storage is wrapped because private mode and blocked site-data both THROW on access. */
type Storage = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };

function storage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function saveBasket<T>(itemsKey: string, result: T, now = Date.now()): void {
  const s = storage();
  if (!s || !itemsKey) return;
  try {
    s.setItem(KEY, JSON.stringify({ itemsKey, savedAt: now, result } satisfies CachedBasket<T>));
  } catch {
    /* quota, private mode — a missing cache is a degraded experience, never an error */
  }
}

/**
 * The cached result for THIS list, with its age — or null.
 *
 * Returns null rather than stale data when: nothing is cached, the cache is for a different
 * list, the payload is unreadable, or it is older than MAX_CACHE_AGE_MS.
 */
export function loadBasket<T>(itemsKey: string, now = Date.now()): { result: T; freshness: Freshness } | null {
  const s = storage();
  if (!s || !itemsKey) return null;
  let raw: string | null;
  try { raw = s.getItem(KEY); } catch { return null; }
  if (!raw) return null;

  let parsed: CachedBasket<T>;
  try { parsed = JSON.parse(raw) as CachedBasket<T>; } catch { return null; }
  if (!parsed || typeof parsed !== "object") return null;
  if (parsed.itemsKey !== itemsKey) return null;          // a different list — never serve it
  if (typeof parsed.savedAt !== "number") return null;

  const ageMs = now - parsed.savedAt;
  if (ageMs < 0) return null;                              // clock moved backwards; do not trust it
  const freshness = describeAge(ageMs, now);
  if (freshness.tooOld) return null;

  return { result: parsed.result, freshness };
}

export function clearBasketCache(): void {
  const s = storage();
  try { s?.removeItem(KEY); } catch { /* ignore */ }
}
