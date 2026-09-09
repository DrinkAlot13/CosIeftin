"use client";

// A product grid whose sort control lives in the browser.
//
// WHY IT MOVED. Sorting was a `?sort=` link, and reading `searchParams` makes a page dynamic in
// Next 14 — so every category page re-rendered on the server for every visitor, and the only
// thing that varied was the order of a list already in hand. Sorting here instead lets
// /c/[slug] be generated once and revalidated when the prices change, and the sort itself
// becomes instant rather than a round trip.
//
// The ORDER and, since 2026-09-09, WHICH SUBSET is drawn. What each product costs and how many
// shops carry it were both settled on the server by `getCategoryPage`; this never recomputes a
// price and never invents a shop count. The comparability toggle is here for the same reason
// sorting is: `?comparabile=` would read searchParams and make the page dynamic again.

import { useMemo, useState } from "react";
import { ProductCard, type CardProduct } from "@/components/ProductCard";

export type SortableProduct = CardProduct & {
  summary: { lowest: number; offerCount: number; lowestBani: number };
  unitLowest: number;
  /** Distinct merchants showing a price we can stand behind. 1 means "not comparable today". */
  shopCount?: number;
};

const SORTS = [
  { key: "unit-asc", label: "Preț/unitate" },
  { key: "price-asc", label: "Preț" },
  { key: "name", label: "Nume" },
] as const;

type SortKey = (typeof SORTS)[number]["key"];

/**
 * How many cards are put in the HTML at once.
 *
 * The Neîncadrate leaf holds 1,583 products and rendering all of them produced a 2.9 MB
 * document — the same defect /necategorisate was paginated to fix, arriving back through the
 * front door the moment that listing became an ordinary category. Brânzeturi was 966 KB.
 *
 * The remaining products are NOT dropped: they travel in the RSC payload as data, which is a
 * fraction of the size of the same rows as markup, and "Arată mai multe" reveals them without a
 * round trip. The COUNT above the grid is always the full count — it is what the page holds,
 * not what it has drawn.
 */
const PAGE_SIZE = 120;

export function SortableProductGrid({
  products,
  emptyText,
  /**
   * Start with only comparable products.
   *
   * ON for BROWSING, OFF for SEARCH, and the difference is what the shopper has told us. Someone
   * browsing a category has not named a product, so the useful thing to show is the set this
   * site can actually answer a question about. Someone who TYPED a product name wants that
   * product, and hiding it because only one shop stocks it would be answering a question they
   * did not ask.
   *
   * Measured: 7.3% of grocery products are comparable, but 52.5% of the forty staples people
   * actually buy. The site is good at the shop and thin on the long tail, and it presented both
   * identically — so a shopper browsing met a wall of "1 magazin" and concluded it was broken.
   */
  comparableOnlyByDefault = false,
}: {
  products: SortableProduct[];
  emptyText: string;
  comparableOnlyByDefault?: boolean;
}) {
  const [sort, setSort] = useState<SortKey>("unit-asc");
  const [shown, setShown] = useState(PAGE_SIZE);
  const [comparableOnly, setComparableOnly] = useState(comparableOnlyByDefault);

  // NOTHING IS HIDDEN PERMANENTLY: the toggle is on the page, it says how many it is holding
  // back, and one click restores them.
  const comparableCount = useMemo(
    () => products.filter((p) => (p.shopCount ?? 0) >= 2).length,
    [products],
  );

  const sorted = useMemo(() => {
    const copy = comparableOnly ? products.filter((p) => (p.shopCount ?? 0) >= 2) : [...products];
    // Identical comparators to the ones the server used, so a page rendered before hydration
    // and the same page after it are in the same order.
    copy.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name, "ro");
      if (sort === "price-asc") return a.summary.lowestBani - b.summary.lowestBani;
      // 0 means "we could not compute a unit price for this product", not "it is free". Sorting
      // it as a number put every unknown at the TOP of "cheapest per unit". Unknowns go last.
      const au = a.unitLowest > 0 ? a.unitLowest : Infinity;
      const bu = b.unitLowest > 0 ? b.unitLowest : Infinity;
      return au - bu;
    });
    return copy;
  }, [products, sort, comparableOnly]);

  // Re-sorting reorders the whole set, so the first 120 of the new order is a different 120.
  // Keeping the old `shown` would silently show a slice of one ordering under the heading of
  // another.
  const visible = sorted.slice(0, shown);
  const remaining = sorted.length - visible.length;

  return (
    <>
      <div className="toolbar">
        {/* THE COUNT ALWAYS DESCRIBES WHAT IS ACTUALLY LISTED. A heading that says 966 above a
            list of 74 is the same class of defect as a price that is not the price. */}
        <span className="muted">{sorted.length.toLocaleString("ro-RO")} produse</span>
        <button
          type="button"
          className={`linklike${comparableOnly ? " active" : ""}`}
          aria-pressed={comparableOnly}
          onClick={() => { setComparableOnly((v) => !v); setShown(PAGE_SIZE); }}
          title={comparableOnly
            ? `Arată și produsele cu preț într-un singur magazin (${(products.length - comparableCount).toLocaleString("ro-RO")})`
            : "Arată doar produsele pe care le poți compara între magazine"}
        >
          {comparableOnly ? "✓ " : ""}Doar produse comparabile
        </button>
        <div className="sortlinks">
          <span className="muted">Sortează:</span>
          {SORTS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => { setSort(s.key); setShown(PAGE_SIZE); }}
              className={`linklike${sort === s.key ? " active" : ""}`}
              aria-pressed={sort === s.key}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {sorted.length === 0 ? (
        <div className="empty">
          {comparableOnly && products.length > 0
            ? "Niciun produs din această categorie nu are preț în două magazine acum. Scoate filtrul ca să le vezi pe toate."
            : emptyText}
        </div>
      ) : (
        <>
          <div className="grid-products">
            {visible.map((p) => <ProductCard key={p.id} p={p} />)}
          </div>
          {remaining > 0 && (
            <div className="show-more">
              <button type="button" className="btn" onClick={() => setShown((n) => n + PAGE_SIZE)}>
                Arată mai multe ({remaining.toLocaleString("ro-RO")} rămase)
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
