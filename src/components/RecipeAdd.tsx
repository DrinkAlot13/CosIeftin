"use client";

import Link from "next/link";
import { useState } from "react";
import { addItem, createCart } from "@/lib/carts";

/** Resolve each ingredient to the top matching product and add it to a fresh cart. */
export function RecipeAdd({ name, ingredients }: { name: string; ingredients: string[] }) {
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const [added, setAdded] = useState(0);

  async function run() {
    setState("loading");
    createCart(name); // dedicated cart per recipe
    let n = 0;
    for (const ing of ingredients) {
      try {
        const r = await fetch(`/api/suggest?q=${encodeURIComponent(ing)}`);
        const list: { slug: string; name: string }[] = await r.json();
        if (list[0]) {
          addItem({ slug: list[0].slug, name: list[0].name, qty: 1 });
          n++;
        }
      } catch {
        /* skip ingredient */
      }
    }
    setAdded(n);
    setState("done");
  }

  if (state === "done") {
    return (
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span className="muted">✓ {added}/{ingredients.length} adăugate</span>
        <Link href="/lista" className="btn btn-accent">Vezi coșul →</Link>
      </div>
    );
  }
  return (
    <button type="button" className="btn btn-outline" onClick={run} disabled={state === "loading"}>
      {state === "loading" ? "Se adaugă…" : "🛒 Adaugă în coș"}
    </button>
  );
}
