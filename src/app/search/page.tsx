// Search results — including the result "we do not stock this".
//
// The page used to render one thing: a grid, or "Niciun rezultat". It had no way to express the
// answer a brand query most often needs, which is "we do not have illy, but here is what we do
// have in that category". So "illy capsule" showed 208 Starbucks and Nescafé capsules under the
// heading "Rezultate pentru «illy capsule»" — the products were real, the heading was a lie.
//
// Three states now, and the difference between the second and third is the whole point:
//   results     — ordinary hits.
//   brand-miss  — a term matched nothing. Named explicitly, and everything below it is
//                 introduced as an ALTERNATIVE before the shopper sees a single card.
//   empty       — nothing to show and nothing specific to say.

import Link from "next/link";
import { ProductCard } from "@/components/ProductCard";
import { Pagination } from "@/components/Pagination";
import { searchProducts } from "@/lib/queries";
import { isKnownBrand } from "@/lib/search/brands";

export const dynamic = "force-dynamic";

export async function generateMetadata({ searchParams }: { searchParams: { q?: string } }) {
  const q = (searchParams.q ?? "").trim();
  return { title: q ? `Căutare: ${q}` : "Căutare" };
}

/** "illy" · "illy și kelloggs" — Romanian list joining, so the sentence reads. */
function joinRo(terms: string[]): string {
  if (terms.length <= 1) return terms[0] ?? "";
  return `${terms.slice(0, -1).join(", ")} și ${terms[terms.length - 1]}`;
}

export default async function SearchPage({ searchParams }: { searchParams: { q?: string; page?: string } }) {
  const q = (searchParams.q ?? "").trim();
  const page = Math.max(1, Number(searchParams.page ?? 1) || 1);
  // `total` is the number of MATCHES, from ranking the whole catalog. `products` is one page of
  // them. The heading reports the total, never the page size — a search that says "(120)"
  // because 120 is the page length tells the shopper nothing about what was found.
  const { kind, missing, corrections, products, total, page: current, pages } = await searchProducts(q, page);
  const missName = joinRo(missing);

  return (
    <div className="container">
      <div className="section" style={{ paddingBottom: 8 }}>
        <h1 style={{ fontSize: 24 }}>
          {q ? (
            <>
              {kind === "brand-miss" ? "Căutare pentru" : "Rezultate pentru"} „{q}”
              {kind !== "brand-miss" && total > 0 && (
                <span className="muted" style={{ fontWeight: 400, fontSize: 16 }}> ({total.toLocaleString("ro-RO")})</span>
              )}
            </>
          ) : (
            "Caută un produs"
          )}
        </h1>
        {corrections.length > 0 && (
          <p className="muted" style={{ fontSize: 14, marginTop: 2 }}>
            Am căutat {corrections.map(([from, to]) => <b key={from}>{to}</b>).reduce<React.ReactNode[]>((acc, el, i) => (i === 0 ? [el] : [...acc, ", ", el]), [])}
            {" "}în loc de „{corrections.map(([from]) => from).join(", ")}”.
          </p>
        )}
      </div>

      {!q ? (
        <div className="empty">Scrie în bara de căutare de sus (ex. „lapte”, „ulei”, „ouă”).</div>
      ) : kind === "brand-miss" ? (
        <>
          {/* The refusal comes FIRST and on its own, above any card. A shopper who scrolls
              straight to the grid must not be able to mistake an alternative for a match. */}
          {/* A missing BRAND and a missing product WORD need different sentences. "Nu am găsit
              produse ulei" is not Romanian anyone would write; the honest sentence for
              "ulei baneasa" is that we could not match that word, not that a brand is absent. */}
          <div className="search-miss" role="status">
            {missing.every((m) => isKnownBrand(m)) ? (
              <>
                <p className="search-miss-head">Nu am găsit produse <b>{missName}</b>.</p>
                <p className="muted" style={{ margin: "6px 0 0", fontSize: 14 }}>
                  Niciun magazin urmărit de noi nu are acum {missName} în stoc.
                </p>
              </>
            ) : (
              <>
                <p className="search-miss-head">
                  Nu am găsit nimic pentru <b>„{missName}”</b> în această căutare.
                </p>
                <p className="muted" style={{ margin: "6px 0 0", fontSize: 14 }}>
                  Am căutat restul termenilor din „{q}”.
                </p>
              </>
            )}
          </div>
          {products.length > 0 ? (
            <>
              <h2 style={{ fontSize: 17, margin: "22px 0 10px" }}>
                Alternative din aceeași categorie{" "}
                <span className="muted" style={{ fontWeight: 400, fontSize: 15 }}>({total.toLocaleString("ro-RO")})</span>
              </h2>
              <p className="muted" style={{ fontSize: 13.5, margin: "0 0 14px" }}>
                Acestea <b>nu sunt {missName}</b>. Sunt produse asemănătoare, de la alte mărci.
              </p>
              <div className="grid-products">
                {products.map((p) => <ProductCard key={p.id} p={p} />)}
              </div>
              <Pagination page={current} pages={pages} total={total} basePath="/search" params={{ q }} />
            </>
          ) : (
            <p className="muted" style={{ marginTop: 16 }}>
              Nu avem nici produse asemănătoare de propus. Încearcă un termen mai general, de
              exemplu <Link href="/search?q=cafea">cafea</Link>.
            </p>
          )}
        </>
      ) : products.length === 0 ? (
        <div className="empty">Niciun rezultat pentru „{q}”. Încearcă alt termen.</div>
      ) : (
        <>
          <div className="grid-products">
            {products.map((p) => <ProductCard key={p.id} p={p} />)}
          </div>
          <Pagination page={current} pages={pages} total={total} basePath="/search" params={{ q }} />
        </>
      )}
      <div style={{ height: 32 }} />
    </div>
  );
}
