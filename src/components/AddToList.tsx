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
function recordAdd(productId?: number) {
  if (!productId) return;
  void fetch("/api/favorites", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ productId, add: true }),
  }).catch(() => { /* the add already happened; the count is best-effort */ });
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
