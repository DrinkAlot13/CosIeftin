"use client";
// Add a recipe by its NEEDS, showing what was chosen and why before anything is committed.
//
// The old version hit /api/suggest per free-text ingredient and added the first search result,
// silently. The shopper saw "✓ 6/6 adăugate" and had no idea which six products those were, nor
// why. Search ranking is not a shopping preference: it cannot know what you buy, what you have
// hearted, or what costs less per kilogram.
//
// Now the recipe resolves first and REPORTS, then the shopper adds. Each line names the product,
// the reason in Romanian, and how many alternatives existed; unavailable needs are listed as
// unavailable rather than filled with something else.

import Link from "next/link";
import { useState } from "react";
import { addItem, createCart } from "@/lib/carts";

type Line = {
  classSlug: string;
  label: string;
  qty: number;
  unavailable: boolean;
  why: string;
  alternatives: number;
  chosen: { productId: number; slug: string; name: string; brand: string | null; priceBani: number } | null;
};

const lei = (bani: number) => `${(bani / 100).toFixed(2).replace(".", ",")} lei`;

export function RecipeAdd({ slug, name, count }: { slug: string; name: string; count: number }) {
  const [state, setState] = useState<"idle" | "loading" | "preview" | "added">("idle");
  const [lines, setLines] = useState<Line[]>([]);

  async function resolve() {
    setState("loading");
    try {
      const r = await fetch("/api/recipe/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      const j = (await r.json()) as { lines?: Line[] };
      setLines(j.lines ?? []);
      setState("preview");
    } catch {
      setState("idle");
    }
  }

  function commit() {
    createCart(name);
    for (const l of lines) {
      if (l.unavailable || !l.chosen) continue;
      addItem({ slug: l.chosen.slug, name: l.chosen.name, qty: l.qty });
      void fetch("/api/favorites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productId: l.chosen.productId, add: true }),
      }).catch(() => { /* the add already happened */ });
    }
    setState("added");
  }

  if (state === "added") {
    const n = lines.filter((l) => !l.unavailable).length;
    return (
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span className="muted">✓ {n} produse adăugate</span>
        <Link href="/lista" className="btn btn-accent">Vezi coșul →</Link>
      </div>
    );
  }

  if (state === "preview") {
    const missing = lines.filter((l) => l.unavailable);
    return (
      <div style={{ marginTop: 8 }}>
        <ul className="recipe-lines">
          {lines.map((l) => (
            <li key={l.classSlug} className={l.unavailable ? "missing" : undefined}>
              {l.unavailable ? (
                <>
                  <b>{l.label}</b>
                  <span className="muted"> — {l.why}</span>
                </>
              ) : (
                <>
                  <Link href={`/p/${l.chosen!.slug}`}>{l.chosen!.name}</Link>
                  <span className="muted">
                    {" "}— {l.why}
                    {l.alternatives > 0 && ` · ${l.alternatives} alternative`}
                  </span>
                  <span className="recipe-price">{lei(l.chosen!.priceBani)}</span>
                </>
              )}
            </li>
          ))}
        </ul>
        {missing.length > 0 && (
          <p className="muted" style={{ fontSize: 12.5, margin: "6px 0 0" }}>
            {missing.length} din {lines.length} nu se găsesc acum. Le lăsăm afară — nu punem
            altceva în loc.
          </p>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-accent" onClick={commit}>
            Adaugă {lines.length - missing.length} în coș
          </button>
          <button type="button" className="btn btn-outline" onClick={() => setState("idle")}>Renunță</button>
        </div>
      </div>
    );
  }

  return (
    <button type="button" className="btn btn-outline" onClick={resolve} disabled={state === "loading"}>
      {state === "loading" ? "Se caută…" : `🛒 Vezi ce alegem (${count})`}
    </button>
  );
}
