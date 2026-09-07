// The full category tree, on its own page.
//
// WHY A PAGE AND NOT AN "EXPAND" ON THE HOMEPAGE. The homepage used to render every grocery
// category as an identically-weighted tile — 93 of them once the two-level tree was populated —
// which is a wall, not a menu. The obvious fix is to show eight and expand to the rest in place;
// the reason not to is that "the rest" is not a longer flat list, it is a SECOND LEVEL. A
// department means something different from a shelf, and a tile grid cannot say so: expanding
// would rebuild the same wall one click later.
//
// A page can show the structure — department, then its shelves, with counts on both — and it is
// a URL a shopper can bookmark and a crawler can index, which an expanding div is not.
//
// Every number here comes from `getCategoryNav`, the same source as the sidebar's, so the count
// on a shelf here is the count on that shelf there and the count on the page it opens.

import Link from "next/link";
import { getCategoryNav } from "@/lib/category-nav";

export const revalidate = 86400; // dropped by tag when the nightly finishes; see lib/cache-tags

export const metadata = {
  title: "Toate categoriile",
  description: "Toate departamentele și raioanele din CoșMic, cu numărul de produse cu preț azi.",
};

export default async function CategoryIndexPage() {
  const nav = await getCategoryNav("grocery");

  return (
    <div className="container">
      <nav className="breadcrumb" aria-label="breadcrumb" style={{ marginTop: 16 }}>
        <Link href="/">Acasă</Link>
        <span className="sep">/</span>
        <span>Categorii</span>
      </nav>

      <div className="section-head" style={{ marginTop: 8 }}>
        <h1 style={{ fontSize: 26 }}>Toate categoriile</h1>
      </div>
      <p className="muted" style={{ maxWidth: 640, marginTop: -4 }}>
        {nav.total.toLocaleString("ro-RO")} produse cu preț azi, în {nav.departments.length} departamente.
        Numărul de lângă fiecare raion este câte produse găsești acolo acum.
      </p>

      <div className="cat-index">
        {nav.departments.map((d) => (
          <section key={d.slug} className="card cat-index__dept">
            <Link href={`/c/${d.slug}`} className="cat-index__head">
              <span className="cat-index__emoji" aria-hidden>{d.icon ?? "🛒"}</span>
              <span className="cat-index__name">{d.name}</span>
              <span className="cat-index__count">{d.count.toLocaleString("ro-RO")}</span>
            </Link>
            <ul className="cat-index__leaves">
              {d.leaves.map((l) => (
                <li key={l.slug}>
                  <Link href={`/c/${l.slug}`} className={l.isRemainder ? "is-remainder" : undefined}>
                    {/* The "-altele" leaves hold the rest of a department, so they say so rather
                        than repeating the word "Altele" thirteen times down the page. */}
                    <span>{l.isRemainder ? `Restul din ${d.name}` : l.name}</span>
                    <span className="cat-index__count">{l.count.toLocaleString("ro-RO")}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div style={{ height: 40 }} />
    </div>
  );
}
