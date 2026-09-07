import Link from "next/link";
import { ProductCard } from "@/components/ProductCard";
import { countStats, getHomeSections } from "@/lib/queries";
import { getCategoryNav } from "@/lib/category-nav";
import { UNPLACED_DEPARTMENT_SLUG } from "@/lib/category/tree";

// Prices refresh once a night, so serve these from cache and regenerate hourly —
// nearly-free performance vs hitting the DB on every request.
export const revalidate = 3600;

export default async function HomePage() {
  const [{ featured, drops }, nav, stats] = await Promise.all([
    getHomeSections(),
    getCategoryNav("grocery"),
    countStats(),
  ]);
  // EIGHT TILES, CHOSEN BY LIVE PRODUCT COUNT — not sixty in alphabetical-by-id order.
  //
  // This rendered every grocery category, which became 93 the moment the two-level tree was
  // populated: a wall of identically-weighted tiles in which nothing is findable and nothing is
  // recommended. Eight is the number that still reads as a set at a glance.
  //
  // Ordered by how much a shopper can actually compare in each, which is the only ranking the
  // page has any evidence for. The rest are one click away on /categorii, which can show the
  // two-level structure a flat tile grid cannot.
  //
  // "Neîncadrate" is excluded here even though it is large enough to rank. It is not a
  // department a shopper browses — it is the pile our own classifier could not place, and
  // putting it on the front page alongside Lactate și ouă advertises our filing as if it were a
  // shelf. It stays in the sidebar and on /categorii, where a person looking for it will find
  // it, and it stays counted.
  const topDepartments = nav.departments
    .filter((d) => d.slug !== UNPLACED_DEPARTMENT_SLUG)
    .slice(0, 8);

  return (
    <>
      <section className="hero">
        <div className="container">
          <h1>Cumpără mai ieftin. Compară prețurile la alimente.</h1>
          <p>Vezi unde e cel mai ieftin fiecare produs și fă-ți lista de cumpărături inteligentă.</p>
          <div className="hero-search">
            <form action="/search" method="get" role="search">
              <input type="search" name="q" placeholder="Caută: lapte, pâine, ouă, ulei…" aria-label="Caută produse" autoComplete="off" />
              <button type="submit">Caută</button>
            </form>
          </div>
          <div className="hero-stats">
            <span><b>{stats.products.toLocaleString("ro-RO")}</b> produse</span>
            <span><b>{stats.offers.toLocaleString("ro-RO")}</b> prețuri</span>
            {/* "magazine alimentare", not "magazine": this counter is grocery-scoped and always was.
                A bare "magazine" reads as every shop on the site, which is a different number. */}
            {/* The number that keeps the other two honest: of all those products, how many can
                actually be compared. Without it "37.258 produse" reads as 37.258 comparisons. */}
            <span><b>{stats.comparable.toLocaleString("ro-RO")}</b> comparabile în 2+ magazine</span>
            <span><b>{stats.chains}</b> magazine alimentare</span>
          </div>
          <div style={{ marginTop: 18 }}>
            <Link className="btn btn-accent" href="/lista">🛒 Fă o listă de cumpărături →</Link>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head">
            <h2>Categorii</h2>
            <Link href="/categorii" className="section-more">Vezi toate categoriile →</Link>
          </div>
          <div className="grid-cats">
            {topDepartments.map((d) => (
              <Link key={d.slug} className="card catcard" href={`/c/${d.slug}`}>
                <span className="catemoji" aria-hidden>{d.icon ?? "🛒"}</span>
                <span className="catname">{d.name}</span>
                <span className="catcount">{d.count.toLocaleString("ro-RO")} produse</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {drops.length > 0 && (
        <section className="section">
          <div className="container">
            <div className="section-head"><h2>📉 Cele mai mari scăderi de preț</h2></div>
            <div className="grid-products">
              {drops.map((p) => <ProductCard key={p.id} p={p} />)}
            </div>
          </div>
        </section>
      )}

      <section className="section">
        <div className="container">
          <div className="section-head"><h2>Produse populare</h2></div>
          <div className="grid-products">
            {featured.map((p) => <ProductCard key={p.id} p={p} />)}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head"><h2>Cum funcționează</h2></div>
          <div className="how">
            <div className="card step"><div className="n">1</div><h3>Adaugă produsele</h3><p className="muted">Caută și pune în listă ce vrei să cumperi.</p></div>
            <div className="card step"><div className="n">2</div><h3>Comparăm magazinele</h3><p className="muted">Calculăm unde e cel mai ieftin coșul tău.</p></div>
            <div className="card step"><div className="n">3</div><h3>Economisești</h3><p className="muted">Vezi cel mai ieftin magazin sau cum împarți cumpărăturile.</p></div>
          </div>
        </div>
      </section>
    </>
  );
}
