import Link from "next/link";
import { ProductCard } from "@/components/ProductCard";
import { countStats, getHomeSections, getMenuCategories } from "@/lib/queries";

// Prices refresh once a night, so serve these from cache and regenerate hourly —
// nearly-free performance vs hitting the DB on every request.
export const revalidate = 3600;

export default async function HomePage() {
  const [{ featured, drops }, categories, stats] = await Promise.all([
    getHomeSections(),
    getMenuCategories(),
    countStats(),
  ]);

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
            <span><b>{stats.products}</b> produse</span>
            <span><b>{stats.offers}</b> prețuri</span>
            {/* "magazine alimentare", not "magazine": this counter is grocery-scoped and always was.
                A bare "magazine" reads as every shop on the site, which is a different number. */}
            <span><b>{stats.chains}</b> magazine alimentare</span>
          </div>
          <div style={{ marginTop: 18 }}>
            <Link className="btn btn-accent" href="/lista">🛒 Fă o listă de cumpărături →</Link>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head"><h2>Categorii</h2></div>
          <div className="grid-cats">
            {categories.map((c) => (
              <Link key={c.id} className="card catcard" href={`/c/${c.slug}`}>
                <span className="catemoji" aria-hidden>{c.icon}</span>
                <span className="catname">{c.name}</span>
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
