import Link from "next/link";
import { notFound } from "next/navigation";
import { SortableProductGrid } from "@/components/SortableProductGrid";
import { getCategoryPage } from "@/lib/queries";
import { CategorySidebar } from "@/components/CategorySidebar";
import { getCategoryNav } from "@/lib/category-nav";

/**
 * GENERATED ONCE PER PRICE UPDATE, NOT ONCE PER VISITOR.
 *
 * This declared `force-dynamic` and read `?sort=` from the query string, so every visit to
 * every category re-ran the whole page on the server — and the only thing that varied between
 * two visitors was the order of a list already in hand. Sorting now happens in the browser
 * (`<SortableProductGrid>`), which is both instant and the thing that makes caching possible:
 * a page that reads `searchParams` cannot be cached in Next 14, whatever it declares.
 *
 * The window is a day, but it is not what actually refreshes the page: `npm run revalidate`
 * runs at the end of the nightly and drops these by tag, so a shopper sees new prices when the
 * prices are new rather than when a timer happens to expire. The window is the backstop for a
 * nightly that failed to finish.
 */
export const revalidate = 86400;

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const data = await getCategoryPage(params.slug);
  return { title: data ? data.category.name : "Categorie" };
}

export default async function CategoryPage({ params }: { params: { slug: string } }) {
  const [data, nav] = await Promise.all([
    getCategoryPage(params.slug),
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

          <SortableProductGrid products={products} emptyText="Niciun produs în această categorie." />

          <div style={{ height: 32 }} />
        </div>
      </div>
    </div>
  );
}
