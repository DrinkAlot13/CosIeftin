import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductCard } from "@/components/ProductCard";
import { getCategoryPage, type SortKey } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const data = await getCategoryPage(params.slug);
  return { title: data ? data.category.name : "Categorie" };
}

const SORTS: { key: SortKey; label: string }[] = [
  { key: "unit-asc", label: "Preț/unitate" },
  { key: "price-asc", label: "Preț" },
  { key: "name", label: "Nume" },
];

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { sort?: string };
}) {
  const sort = (searchParams.sort as SortKey) || "unit-asc";
  const data = await getCategoryPage(params.slug, sort);
  if (!data) notFound();
  const { category, products } = data;

  return (
    <div className="container">
      <nav className="breadcrumb" aria-label="breadcrumb">
        <Link href="/">Acasă</Link>
        <span className="sep">/</span>
        <span>{category.name}</span>
      </nav>
      <div className="section-head" style={{ marginTop: 8 }}>
        <h1 style={{ fontSize: 26 }}>{category.icon ? `${category.icon} ` : ""}{category.name}</h1>
      </div>
      <div className="toolbar">
        <span className="muted">{products.length} produse</span>
        <div className="sortlinks">
          <span className="muted">Sortează:</span>
          {SORTS.map((s) => (
            <Link key={s.key} href={`/c/${category.slug}?sort=${s.key}`} className={sort === s.key ? "active" : undefined}>
              {s.label}
            </Link>
          ))}
        </div>
      </div>
      {products.length === 0 ? (
        <div className="empty">Niciun produs în această categorie.</div>
      ) : (
        <div className="grid-products">
          {products.map((p) => <ProductCard key={p.id} p={p} />)}
        </div>
      )}
      <div style={{ height: 32 }} />
    </div>
  );
}
