import Link from "next/link";
import { CardBoundary } from "@/components/CardBoundary";
import { ProductCard } from "@/components/ProductCard";
import { getSectionCategories, getSectionProducts, type SortKey } from "@/lib/queries";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "price-asc", label: "Preț" },
  { key: "name", label: "Nume" },
];

/** Shared storefront-section listing (dcneu / cosmetice / farmacie / makeup): sub-category
 *  chips (if any) + search + sort + product grid. */
export async function SectionListing({
  section,
  base,
  title,
  blurb,
  sort,
  q,
  cat,
  emptyHint,
}: {
  section: string;
  base: string;
  title: string;
  blurb: string;
  sort: SortKey;
  q?: string;
  cat?: string;
  emptyHint: string;
}) {
  const [all, categories] = await Promise.all([getSectionProducts(section, sort, q, cat), getSectionCategories(section)]);
  const products = all.slice(0, 300);
  const activeCat = categories.find((c) => c.slug === cat);
  const link = (extra: { cat?: string | null; sort?: string }) => {
    const p = new URLSearchParams();
    const c = extra.cat === null ? undefined : extra.cat ?? cat;
    if (c) p.set("cat", c);
    if (extra.sort ?? sort) p.set("sort", extra.sort ?? sort);
    if (q) p.set("q", q);
    const s = p.toString();
    return s ? `${base}?${s}` : base;
  };

  return (
    <div className="container">
      <nav className="breadcrumb" aria-label="breadcrumb">
        <Link href="/">Acasă</Link>
        <span className="sep">/</span>
        <span>{title}</span>
      </nav>
      <div className="section-head" style={{ marginTop: 8 }}>
        <h1 style={{ fontSize: 26 }}>{title}{activeCat ? ` · ${activeCat.name}` : ""}</h1>
      </div>
      <p className="muted" style={{ marginTop: -4 }}>{blurb}</p>

      {categories.length > 0 && (
        <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "10px 0", whiteSpace: "nowrap" }}>
          <Link href={link({ cat: null })} className={!cat ? "chip active" : "chip"}>Toate</Link>
          {categories.map((c) => (
            <Link key={c.id} href={link({ cat: c.slug })} className={cat === c.slug ? "chip active" : "chip"}>{c.name}</Link>
          ))}
        </div>
      )}

      <form action={base} method="get" className="toolbar" style={{ gap: 8 }}>
        <input type="search" name="q" defaultValue={q ?? ""} placeholder="Caută…" className="input" style={{ maxWidth: 320 }} />
        <input type="hidden" name="sort" value={sort} />
        {cat && <input type="hidden" name="cat" value={cat} />}
        <button type="submit" className="btn">Caută</button>
        <span className="muted" style={{ marginLeft: "auto" }}>{all.length} produse</span>
        <div className="sortlinks">
          <span className="muted">Sortează:</span>
          {SORTS.map((s) => (
            <Link key={s.key} href={link({ sort: s.key })} className={sort === s.key ? "active" : undefined}>{s.label}</Link>
          ))}
        </div>
      </form>

      {products.length === 0 ? (
        <div className="empty">{emptyHint}</div>
      ) : (
        <div className="grid-products">
          {/* One bad row costs one card, not the other 47 on the page. */}
          {products.map((p) => (
            <CardBoundary key={p.id} label={p.name}>
              <ProductCard p={p} />
            </CardBoundary>
          ))}
        </div>
      )}
      <div style={{ height: 32 }} />
    </div>
  );
}
