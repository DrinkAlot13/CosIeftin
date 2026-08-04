import { ProductCard } from "@/components/ProductCard";
import { searchProducts } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function generateMetadata({ searchParams }: { searchParams: { q?: string } }) {
  const q = (searchParams.q ?? "").trim();
  return { title: q ? `Căutare: ${q}` : "Căutare" };
}

export default async function SearchPage({ searchParams }: { searchParams: { q?: string } }) {
  const q = (searchParams.q ?? "").trim();
  const results = q ? await searchProducts(q) : [];

  return (
    <div className="container">
      <div className="section" style={{ paddingBottom: 8 }}>
        <h1 style={{ fontSize: 24 }}>
          {q ? (
            <>
              Rezultate pentru „{q}”{" "}
              <span className="muted" style={{ fontWeight: 400, fontSize: 16 }}>({results.length})</span>
            </>
          ) : (
            "Caută un produs"
          )}
        </h1>
      </div>
      {!q ? (
        <div className="empty">Scrie în bara de căutare de sus (ex. „lapte”, „ulei”, „ouă”).</div>
      ) : results.length === 0 ? (
        <div className="empty">Niciun rezultat pentru „{q}”. Încearcă alt termen.</div>
      ) : (
        <div className="grid-products">
          {results.map((p) => <ProductCard key={p.id} p={p} />)}
        </div>
      )}
      <div style={{ height: 32 }} />
    </div>
  );
}
