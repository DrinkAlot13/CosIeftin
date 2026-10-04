"use client";
// Client-side multi-cart store (localStorage). Users can keep several named carts at
// once and switch the active one. Migrates the old single "cosmic_list" into a default
// cart and keeps it in sync, so anything still reading the legacy key keeps working.
// Every mutation dispatches the existing "cosmic-list" event so listeners refresh.

export type CartItem = { slug: string; name: string; qty: number };
export type Cart = { id: string; name: string; items: CartItem[] };
type Store = { carts: Cart[]; activeId: string };

const KEY = "cosmic_carts";
const LEGACY = "cosmic_list";
export const CART_EVENT = "cosmic-list";

const uid = () => Math.random().toString(36).slice(2, 9);

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Store;
      if (s?.carts?.length && s.activeId) return s;
    }
  } catch {
    /* fall through to migration */
  }
  let items: CartItem[] = [];
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY) || "[]");
    if (Array.isArray(legacy)) items = legacy;
  } catch {
    /* ignore */
  }
  const id = uid();
  return { carts: [{ id, name: "Lista mea", items }], activeId: id };
}

function save(s: Store) {
  localStorage.setItem(KEY, JSON.stringify(s));
  const active = s.carts.find((c) => c.id === s.activeId);
  localStorage.setItem(LEGACY, JSON.stringify(active?.items ?? [])); // keep legacy key in sync
  window.dispatchEvent(new Event(CART_EVENT));
}

export function getCarts(): Cart[] {
  return load().carts;
}
export function getActive(): Cart {
  const s = load();
  return s.carts.find((c) => c.id === s.activeId) ?? s.carts[0];
}
export function setActive(id: string) {
  const s = load();
  if (s.carts.some((c) => c.id === id)) {
    s.activeId = id;
    save(s);
  }
}
export function createCart(name?: string): string {
  const s = load();
  const id = uid();
  s.carts.push({ id, name: (name || "").trim() || `Lista ${s.carts.length + 1}`, items: [] });
  s.activeId = id;
  save(s);
  return id;
}
/**
 * "Same list as last time" — the real shape of a recurring shop. Copies the items (fresh
 * quantities, same products) into a new cart and makes it active, so a weekly staples list does
 * not have to be rebuilt by hand from memory every time.
 */
export function duplicateCart(id: string, name?: string): string | null {
  const s = load();
  const src = s.carts.find((c) => c.id === id);
  if (!src) return null;
  const newId = uid();
  s.carts.push({ id: newId, name: (name || "").trim() || `${src.name} (copie)`, items: src.items.map((i) => ({ ...i })) });
  s.activeId = newId;
  save(s);
  return newId;
}

export function renameCart(id: string, name: string) {
  const s = load();
  const c = s.carts.find((c) => c.id === id);
  if (c) {
    c.name = name.trim() || c.name;
    save(s);
  }
}
export function deleteCart(id: string) {
  const s = load();
  s.carts = s.carts.filter((c) => c.id !== id);
  if (s.carts.length === 0) s.carts.push({ id: uid(), name: "Lista mea", items: [] });
  if (!s.carts.some((c) => c.id === s.activeId)) s.activeId = s.carts[0].id;
  save(s);
}

function mutateActive(fn: (items: CartItem[]) => CartItem[]) {
  const s = load();
  const c = s.carts.find((c) => c.id === s.activeId) ?? s.carts[0];
  c.items = fn(c.items);
  save(s);
}
export function addItem(item: CartItem) {
  mutateActive((items) => (items.some((i) => i.slug === item.slug) ? items : [...items, { ...item, qty: item.qty || 1 }]));
}
export function removeItem(slug: string) {
  mutateActive((items) => items.filter((i) => i.slug !== slug));
}
export function setQty(slug: string, qty: number) {
  mutateActive((items) => items.map((i) => (i.slug === slug ? { ...i, qty: Math.max(1, Math.min(99, qty)) } : i)));
}
export function clearActive() {
  mutateActive(() => []);
}
