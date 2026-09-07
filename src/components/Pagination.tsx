import Link from "next/link";

// Page links for a long listing.
//
// The rule this component exists to keep: THE TOTAL IS ALWAYS THE TRUE TOTAL. Pagination
// changes how many cards are on screen, never what the page claims to hold. /necategorisate
// exists precisely so the uncategorised tail stays visible, and a paginated page that reported
// "120 produse" because 120 is what it rendered would hide the thing it was built to show.

export function Pagination({
  page, pages, total, basePath, params,
}: {
  page: number;
  pages: number;
  total: number;
  /** e.g. "/necategorisate" */
  basePath: string;
  /** everything except `page`, preserved across links (sort, q, …) */
  params?: Record<string, string | undefined>;
}) {
  if (pages <= 1) return null;

  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params ?? {})) if (v) sp.set(k, v);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  // First, last, and a window around the current page. Long lists get an ellipsis rather than
  // ninety numbered links.
  const window = new Set<number>([1, pages, page - 1, page, page + 1]);
  const shown = [...window].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);

  return (
    <nav className="pagination" aria-label="Paginare" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", margin: "26px 0 8px" }}>
      {page > 1 && <Link href={href(page - 1)} className="page-link">‹ Înapoi</Link>}
      {shown.map((p, i) => (
        <span key={p} style={{ display: "contents" }}>
          {i > 0 && shown[i - 1] !== p - 1 && <span className="muted" aria-hidden>…</span>}
          {p === page ? (
            <span className="page-link page-current" aria-current="page">{p}</span>
          ) : (
            <Link href={href(p)} className="page-link">{p}</Link>
          )}
        </span>
      ))}
      {page < pages && <Link href={href(page + 1)} className="page-link">Înainte ›</Link>}
      <span className="muted" style={{ marginLeft: 8, fontSize: 13 }}>
        pagina {page} din {pages} · {total.toLocaleString("ro-RO")} produse în total
      </span>
    </nav>
  );
}
