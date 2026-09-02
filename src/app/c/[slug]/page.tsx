import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductCard } from "@/components/ProductCard";
import { getCategoryPage, type SortKey } from "@/lib/queries";
import { CategorySidebar } from "@/components/CategorySidebar";
import { getCategoryNav } from "@/lib/category-nav";

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
  const [data, nav] = await Promise.all([
    getCategoryPage(params.slug, sort),
    getCategoryNav("grocery"),
  ]);
  if (!data) notFound();
  const { category, products } = data;
  // The department this shelf belongs to, so the breadcrumb has the middle step a two-level
  // tree implies. Without it a shopper cannot get back up to the department they came from.
  const parent = nav.departments.find((d) => d.leaves.some((l) => l.slug === category.slug));

  return (
    <div className="container">
      <div className="cat-layout" style={{ marginTop: 16 }}>
      <CategorySidebar nav={nav} activeSlug={category.slug} />
      <div>
      <nav className="breadcrumb" aria-label="breadcrumb">
        <Link href="/">Acasă</Link>
        <span className="sep">/</span>
        {parent ? (
          <>
            <span className="muted">{parent.name}</span>
            <span className="sep">/</span>
          </>
        ) : null}
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
      </div>
    </div>
  );
}
