import Link from "next/link";
import { ProductCard } from "@/components/ProductCard";
import { getAlcoholPage, type SortKey } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata = { title: "Alcool — comparație prețuri" };

const SORTS: { key: SortKey; label: string }[] = [
  { key: "price-asc", label: "Preț" },
  { key: "unit-asc", label: "Preț/litru" },
  { key: "name", label: "Nume" },
];

export default async function AlcoholPage({ searchParams }: { searchParams: { sort?: string; cat?: string } }) {
  const sort = (searchParams.sort as SortKey) || "price-asc";
  const cat = searchParams.cat;
  const { products, categories } = await getAlcoholPage(sort, cat);
  const activeCat = categories.find((c) => c.slug === cat);
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    if (extra.cat ?? cat) p.set("cat", (extra.cat ?? cat) as string);
    if (extra.sort ?? sort) p.set("sort", (extra.sort ?? sort) as string);
    const s = p.toString();
    return s ? `/alcool?${s}` : "/alcool";
  };

  return (
    <div className="container">
      <nav className="breadcrumb" aria-label="breadcrumb">
        <Link href="/">Acasă</Link>
        <span className="sep">/</span>
        <span>Alcool</span>
      </nav>
      <div className="section-head" style={{ marginTop: 8 }}>
        <h1 style={{ fontSize: 26 }}>🍷 Alcool{activeCat ? ` · ${activeCat.name}` : ""}</h1>
      </div>
      <p className="muted" style={{ marginTop: -4 }}>
        Prețuri de la magazine specializate (FineStore, Le Manoir). Separate de coșul alimentar.
      </p>

      <div className="chips" style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "14px 0" }}>
        <Link href={qs({ cat: undefined })} className={!cat ? "chip active" : "chip"}>Toate</Link>
        {categories.map((c) => (
          <Link key={c.id} href={qs({ cat: c.slug })} className={cat === c.slug ? "chip active" : "chip"}>
            {c.icon ? `${c.icon} ` : ""}{c.name}
          </Link>
        ))}
      </div>

      <div className="toolbar">
        <span className="muted">{products.length} produse</span>
        <div className="sortlinks">
          <span className="muted">Sortează:</span>
          {SORTS.map((s) => (
            <Link key={s.key} href={qs({ sort: s.key })} className={sort === s.key ? "active" : undefined}>
              {s.label}
            </Link>
          ))}
        </div>
      </div>

      {products.length === 0 ? (
        <div className="empty">Niciun produs de alcool încă. Rulează scraperele (npm run scrape:alcohol).</div>
      ) : (
        <div className="grid-products">
          {products.map((p) => <ProductCard key={p.id} p={p} />)}
        </div>
      )}
      <div style={{ height: 32 }} />
    </div>
  );
}
