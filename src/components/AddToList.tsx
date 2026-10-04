"use client";

import { useEffect, useState } from "react";
import { addItem, CART_EVENT, getActive, removeItem } from "@/lib/carts";

/**
 * Adding to a list is EVIDENCE, and the third time it happens the product becomes an inferred
 * favourite (see lib/favourites). Carts live in localStorage, so the count cannot be derived
 * server-side later — it has to be recorded at the moment of the add.
 *
 * Fire-and-forget on purpose: a failed count must never block the add. The cart is the thing
 * the shopper asked for; the favourite is a convenience we infer.
 */
export function recordAdd(productId?: number) {
  if (!productId) return;
  const body = JSON.stringify({ productId, add: true });
  const headers = { "content-type": "application/json" };

  // TWO ENDPOINTS, BECAUSE THEY ANSWER TO DIFFERENT PEOPLE.
  //
  // /api/favorites is per-user and 401s an anonymous caller, which is right for a heart and
  // wrong for a counter: with carts in localStorage and no accounts in use, EVERY add by
  // EVERY visitor was recorded nowhere, and "most added" could not be answered at all.
  //
  // /api/list-adds is an anonymous aggregate — one row per product, a total and a date, no
  // user and no event log — so it accepts everyone and stores nothing about anyone.
  void fetch("/api/favorites", { method: "POST", headers, body })
    .catch(() => { /* the add already happened; the favourite is best-effort */ });
  void fetch("/api/list-adds", { method: "POST", headers, body })
    .catch(() => { /* likewise: never let a counter fail an add */ });
}

export function AddToList({ slug, name, productId }: { slug: string; name: string; productId?: number }) {
  const [inList, setInList] = useState(false);
  useEffect(() => {
    const sync = () => setInList(getActive().items.some((i) => i.slug === slug));
    sync();
    window.addEventListener(CART_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CART_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [slug]);

  function toggle() {
    if (getActive().items.some((i) => i.slug === slug)) removeItem(slug);
    else { addItem({ slug, name, qty: 1 }); recordAdd(productId); }
  }

  return (
    <button type="button" className={inList ? "btn btn-accent" : "btn btn-outline"} onClick={toggle}>
      {inList ? "✓ În listă" : "+ Adaugă"}
    </button>
  );
}
