"use client";

// A product grid whose sort control lives in the browser.
//
// WHY IT MOVED. Sorting was a `?sort=` link, and reading `searchParams` makes a page dynamic in
// Next 14 — so every category page re-rendered on the server for every visitor, and the only
// thing that varied was the order of a list already in hand. Sorting here instead lets
// /c/[slug] be generated once and revalidated when the prices change, and the sort itself
// becomes instant rather than a round trip.
//
// The ORDER is the only thing this decides. Which products exist, and what each one costs, was
// settled on the server by `getCategoryPage` — this never filters, never recomputes a price,
// and never drops a card.

import { useMemo, useState } from "react";
import { ProductCard, type CardProduct } from "@/components/ProductCard";

export type SortableProduct = CardProduct & {
  summary: { lowest: number; offerCount: number; lowestBani: number };
  unitLowest: number;
};

const SORTS = [
  { key: "unit-asc", label: "Preț/unitate" },
  { key: "price-asc", label: "Preț" },
  { key: "name", label: "Nume" },
] as const;

type SortKey = (typeof SORTS)[number]["key"];

export function SortableProductGrid({ products, emptyText }: { products: SortableProduct[]; emptyText: string }) {
  const [sort, setSort] = useState<SortKey>("unit-asc");

  const sorted = useMemo(() => {
    const copy = [...products];
    // Identical comparators to the ones the server used, so a page rendered before hydration
    // and the same page after it are in the same order.
    copy.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name, "ro");
      if (sort === "price-asc") return a.summary.lowestBani - b.summary.lowestBani;
      return a.unitLowest - b.unitLowest;
    });
    return copy;
  }, [products, sort]);

  return (
    <>
      <div className="toolbar">
        <span className="muted">{products.length.toLocaleString("ro-RO")} produse</span>
        <div className="sortlinks">
          <span className="muted">Sortează:</span>
          {SORTS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSort(s.key)}
              className={`linklike${sort === s.key ? " active" : ""}`}
              aria-pressed={sort === s.key}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {sorted.length === 0 ? (
        <div className="empty">{emptyText}</div>
      ) : (
        <div className="grid-products">
          {sorted.map((p) => <ProductCard key={p.id} p={p} />)}
        </div>
      )}
    </>
  );
}
