import Link from "next/link";
import { ProductCard } from "@/components/ProductCard";
import { HomeBasket, type Staple } from "@/components/HomeBasket";
import { countStats, getHomeSections, getBiggestSpreads, getBasketStaples } from "@/lib/queries";
import { getCategoryNav } from "@/lib/category-nav";
import { UNPLACED_DEPARTMENT_SLUG } from "@/lib/category/tree";

// Prices refresh once a night, so serve these from cache and regenerate hourly —
// nearly-free performance vs hitting the DB on every request.
export const revalidate = 3600;

export default async function HomePage() {
  const [{ featured, drops }, nav, stats, spreads, staples] = await Promise.all([
    getHomeSections(),
    getCategoryNav("grocery"),
    countStats(),
    getBiggestSpreads(12),
    getBasketStaples(),
  ]);
  const lei = (bani: number) => `${(bani / 100).toFixed(2).replace(".", ",")} lei`;
  // The staples worth showing first: priced, and comparable. The rest of the forty stay on
  // /index-cosmic, where the whole basket including its gaps is the point.
  const shownStaples = staples.filter((s) => s.lowestBani !== null && s.shopCount >= 2).slice(0, 12);
  // ── THE PRE-FILLED BASKET, DERIVED RATHER THAN HARDCODED.
  //
  // Eight lines from the same forty-item index basket, chosen by how many shops actually stock
  // them today. A hardcoded slug list would rot the first time one of those products went out of
  // stock everywhere — and a homepage whose basket cannot be priced is worse than no basket.
  const basketStaples: Staple[] = staples
    .filter((s) => s.lowestBani !== null && s.shopCount >= 2)
    .sort((a, b) => b.shopCount - a.shopCount)
    .slice(0, 8)
    .map((s) => ({ key: s.key, label: s.label, slug: s.slug, shopCount: s.shopCount }));
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
      {/* ── THE HOMEPAGE LEADS WITH AN ANSWER, NOT A CATALOG.
          Nobody wants to browse 29,000 products, and at basket level comparability barely
          matters — the optimizer handles missing lines, so a real total is a real answer even
          when half the items sit at one shop. The basket is pre-filled and editable; the
          headline is what it costs and where. Search stays directly above it, because someone
          who has a product in mind should not have to scroll past a basket to type it. */}
      <section className="hero">
        <div className="container">
          <h1>Cât costă coșul tău? Vezi unde e cel mai ieftin.</h1>
          <div className="hero-search">
            <form action="/search" method="get" role="search">
              <input type="search" name="q" placeholder="Caută: lapte, pâine, ouă, ulei…" aria-label="Caută produse" autoComplete="off" />
              <button type="submit">Caută</button>
            </form>
          </div>

          <HomeBasket staples={basketStaples} />

          {/* ── COMPARABILITY IS NO LONGER THE NUMBER ON THIS PAGE.
              "3.462 de comparat între magazine" was the headline claim and it is the site's
              weakest number — it says what we cannot do more loudly than what we can. The basket
              above answers a question; these are context, moved below it and shrunk. The strict
              count still exists on /metodologie and /admin/stats, where it is the only figure
              that can tell us whether the catalog improved or the definition loosened. */}
          <div className="hero-stats">
            <span><b>{stats.products.toLocaleString("ro-RO")}</b> produse</span>
            <span><b>{stats.offers.toLocaleString("ro-RO")}</b> prețuri</span>
            {/* "magazine alimentare", not "magazine": this counter is grocery-scoped and always was.
                A bare "magazine" reads as every shop on the site, which is a different number. */}
            {/* The number that keeps the other two honest: of all those products, how many can
                actually be compared. Without it "37.258 produse" reads as 37.258 comparisons. */}
            {/* ── ONE NUMBER ON THE HOMEPAGE, THE BROADER ONE, WITH ITS MEANING ATTACHED.
                Two counts side by side read as a contradiction to anyone who has not been told
                the difference. So the shopper-facing figure is the inclusive one and the title
                says what "equivalent" means; the STRICT count still exists and is printed on
                /metodologie and /admin/stats, because it is the only number that can tell us
                whether the catalog improved or the definition loosened. It is never deleted. */}
            <span title="Produse pe care le poți compara între magazine: fie același produs în 2+ magazine, fie produse echivalente — marcă diferită, aceeași nevoie, aceeași mărime (de exemplu zahărul brun de 500 g al fiecărui magazin).">
              <b>{stats.comparableOrEquivalent.toLocaleString("ro-RO")}</b> de comparat între magazine
            </span>
            <span><b>{stats.chains}</b> magazine alimentare</span>
          </div>
          <div style={{ marginTop: 18 }}>
            <Link className="btn btn-accent" href="/lista">🛒 Fă o listă de cumpărături →</Link>
          </div>
        </div>
      </section>

      {/* ── WHAT THIS SITE IS ACTUALLY GOOD AT, FIRST.
          Measured: 7.3% of grocery products compare across two shops, but 52.5% of the forty
          staples people actually buy do. The homepage opened with a category grid, which shows
          neither — so the strong part was invisible on first load and a shopper met the weak
          part by browsing. These two sections lead now; the grid moved below them. */}
      {spreads.length > 0 && (
        <section className="section">
          <div className="container">
            <div className="section-head">
              <h2>💸 Cele mai mari diferențe de preț</h2>
              <Link href="/oferte" className="section-more">Vezi toate ofertele →</Link>
            </div>
            <p className="muted" style={{ marginTop: -6 }}>
              Același produs, prețuri diferite. Atât economisești dacă îl iei din magazinul potrivit.
            </p>
            <div className="grid-products">
              {spreads.map((p) => (
                <Link key={p.id} className="card catcard" href={`/p/${p.slug}`} style={{ alignItems: "flex-start", textAlign: "left", padding: 14 }}>
                  <span style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.3 }}>{p.name.slice(0, 64)}</span>
                  <span style={{ fontSize: 20, fontWeight: 800, marginTop: 6 }}>
                    economisești {lei(p.spreadBani)}
                  </span>
                  <span className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                    {lei(p.lowestBani)} la {p.cheapestShop} · {lei(p.highestBani)} la {p.dearestShop}
                  </span>
                  <span className="muted" style={{ fontSize: 12 }}>{p.shopCount} magazine</span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {shownStaples.length > 0 && (
        <section className="section">
          <div className="container">
            <div className="section-head">
              <h2>🧺 Coșul de bază</h2>
              <Link href="/index-cosmic" className="section-more">Vezi tot coșul →</Link>
            </div>
            <p className="muted" style={{ marginTop: -6 }}>
              Produsele pe care le cumpără toată lumea — și unde sunt cel mai ieftine azi.
            </p>
            <div className="grid-cats">
              {shownStaples.map((s) => (
                <Link key={s.key} className="card catcard" href={`/p/${s.slug}`} style={{ alignItems: "flex-start", textAlign: "left", padding: 14 }}>
                  <span style={{ fontWeight: 600, fontSize: 13.5, lineHeight: 1.3 }}>{s.label}</span>
                  <span style={{ fontSize: 18, fontWeight: 800, marginTop: 6 }}>{lei(s.lowestBani as number)}</span>
                  <span className="muted" style={{ fontSize: 12.5 }}>la {s.cheapestShop}</span>
                  {s.spreadBani > 0 && (
                    <span className="muted" style={{ fontSize: 12 }}>
                      până la {lei((s.lowestBani as number) + s.spreadBani)} în altă parte
                    </span>
                  )}
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

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
