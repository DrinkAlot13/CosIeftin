"use client";

import { useEffect, useState } from "react";

const KEY = "cosmic_list";
type Item = { slug: string; name: string; qty: number };

function read(): Item[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

export function AddToList({ slug, name }: { slug: string; name: string }) {
  const [inList, setInList] = useState(false);
  useEffect(() => {
    const sync = () => setInList(read().some((i) => i.slug === slug));
    sync();
    window.addEventListener("cosmic-list", sync);
    return () => window.removeEventListener("cosmic-list", sync);
  }, [slug]);

  function toggle() {
    let items = read();
    if (items.some((i) => i.slug === slug)) items = items.filter((i) => i.slug !== slug);
    else items = [...items, { slug, name, qty: 1 }];
    localStorage.setItem(KEY, JSON.stringify(items));
    window.dispatchEvent(new Event("cosmic-list"));
  }

  return (
    <button type="button" className={inList ? "btn btn-accent" : "btn btn-outline"} onClick={toggle}>
      {inList ? "✓ În listă" : "+ Adaugă"}
    </button>
  );
}
