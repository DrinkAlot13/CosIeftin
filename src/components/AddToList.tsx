"use client";

import { useEffect, useState } from "react";
import { addItem, CART_EVENT, getActive, removeItem } from "@/lib/carts";

export function AddToList({ slug, name }: { slug: string; name: string }) {
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
    else addItem({ slug, name, qty: 1 });
  }

  return (
    <button type="button" className={inList ? "btn btn-accent" : "btn btn-outline"} onClick={toggle}>
      {inList ? "✓ În listă" : "+ Adaugă"}
    </button>
  );
}
