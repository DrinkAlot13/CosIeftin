// Products with a live price and NO category.
//
// This page exists because hiding them was the worse option. 3,260 grocery products carry no
// category at all — not filed on a department, not in the tree, reachable only if a shopper
// happened to type the right word into search. A sidebar that simply omitted them would look
// tidier and would mean the tail never shrinks, because nobody, including us, would ever see it.
//
// It is deliberately NOT dressed up as a category: no icon, an explanation at the top, and a
// link from the sidebar that sits outside the tree.

import Link from "next/link";
import { ProductCard } from "@/components/ProductCard";
import { CategorySidebar } from "@/components/CategorySidebar";
import { getCategoryNav } from "@/lib/category-nav";
import { getUncategorisedPage, type SortKey } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Produse necategorisate" };

const SORTS: { key: SortKey; label: string }[] = [
  { key: "unit-asc", label: "Preț/unitate" },
  { key: "price-asc", label: "Preț" },
  { key: "name", label: "Nume" },
];

export default async function UncategorisedPage({
  searchParams,
}: {
  searchParams: { sort?: string };
}) {
  const sort = (searchParams.sort as SortKey) || "unit-asc";
  const [{ products }, nav] = await Promise.all([
    getUncategorisedPage(sort),
    getCategoryNav("grocery"),
  ]);

  return (
    <div className="container">
      <div className="cat-layout" style={{ marginTop: 16 }}>
        <CategorySidebar nav={nav} activeSlug="necategorisate" />

        <div>
          <nav className="breadcrumb" aria-label="breadcrumb">
            <Link href="/">Acasă</Link>
            <span className="sep">/</span>
            <span>Necategorisate</span>
          </nav>

          <div className="section-head" style={{ marginTop: 8 }}>
            <h1 style={{ fontSize: 26 }}>Produse necategorisate</h1>
          </div>

          <p className="muted" style={{ maxWidth: 680, marginTop: -4 }}>
            {products.length.toLocaleString("ro-RO")} produse cu preț azi pe care nu le-am putut
            încadra într-o categorie. Prețurile sunt la fel de bune ca oriunde altundeva pe site
            — doar clasificarea lipsește. Le arătăm aici ca să nu dispară din vedere.
          </p>

          {/* Same toolbar markup as the category page — `.sortlinks` is the class that exists;
              a bespoke `.sorts` rendered the three links with no spacing between them. */}
          <div className="toolbar">
            <span className="muted">{products.length} produse</span>
            <div className="sortlinks">
              <span className="muted">Sortează:</span>
              {SORTS.map((s) => (
                <Link key={s.key} href={`/necategorisate?sort=${s.key}`} className={sort === s.key ? "active" : undefined}>
                  {s.label}
                </Link>
              ))}
            </div>
          </div>

          {products.length === 0 ? (
            <p className="muted" style={{ marginTop: 24 }}>Nimic aici acum.</p>
          ) : (
            <div className="grid-products" style={{ marginTop: 18 }}>
              {products.map((p) => (
                <ProductCard key={p.id} p={p} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
