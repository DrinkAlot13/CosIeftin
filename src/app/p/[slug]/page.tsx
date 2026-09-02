import Link from "next/link";
import { notFound } from "next/navigation";
import { AddToList } from "@/components/AddToList";
import { OfferTable } from "@/components/OfferTable";
import { BulkTierTable } from "@/components/BulkTierTable";
import { visibleTiers } from "@/lib/bulk-tiers";
import { priceDisplayFor, priceRange } from "@/lib/reference-price";
import { PriceHistoryChart } from "@/components/PriceHistoryChart";
import { ProductCard } from "@/components/ProductCard";
import { ProductImage } from "@/components/ProductImage";
import { TrackPrice } from "@/components/TrackPrice";
import { formatPerUnit, formatRON } from "@/lib/format";
import { getAlternatives, getItemPage } from "@/lib/queries";
import { abs, breadcrumbJsonLd, jsonLdScript, productJsonLd } from "@/lib/seo";

// Prices refresh once a night, so serve these from cache and regenerate hourly —
// nearly-free performance vs hitting the DB on every request.
export const revalidate = 3600;

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const data = await getItemPage(params.slug);
  if (!data) return { title: "Produs" };
  const canonical = abs(`/p/${data.product.slug}`);
  // The description must not promise more than the page delivers: `offers.length` counts
  // every row including out-of-stock ones, so a page showing one buyable price advertised
  // four shops in search results.
  const shops = data.summary.inStockCount;
  const description = shops > 0
    ? `Compară prețurile pentru ${data.product.name} la ${shops} ${shops === 1 ? "magazin" : "magazine"}. Cel mai mic preț: ${formatRON(data.summary.lowest)}.`
    : `${data.product.name} — momentan fără preț disponibil în magazinele urmărite.`;
  return {
    title: data.product.name,
    description,
    // Without a canonical, every tracking parameter is a separate page competing with itself.
    alternates: { canonical },
    openGraph: {
      title: data.product.name,
      description,
      url: canonical,
      type: "website",
      locale: "ro_RO",
      images: data.product.image ? [data.product.image] : undefined,
    },
  };
}

export default async function ItemPage({ params }: { params: { slug: string } }) {
  const data = await getItemPage(params.slug);
  if (!data) notFound();
  const { product, offers, summary, bestOffer, priceInsight } = data;
  const alternatives = await getAlternatives(product.id);

  const dateSet = new Set<string>();
  for (const o of offers) for (const h of o.history) dateSet.add(h.recordedAt.toISOString().slice(0, 10));
  const chartDates = [...dateSet].sort();
  const chartSeries = offers.map((o) => {
    const byDate = new Map(o.history.map((h) => [h.recordedAt.toISOString().slice(0, 10), h.price]));
    return { name: o.merchant.name, colorIndex: ((o.merchant.id - 1) % 8) + 1, prices: chartDates.map((d) => byDate.get(d) ?? null) };
  });

  // Structured data. Built from the SAME offers rendered below, so the price Google shows and
  // the price on the page cannot disagree.
  const ld = productJsonLd(product, offers);
  const crumbs = breadcrumbJsonLd([
    { name: "Acasă", path: "/" },
    ...(product.category ? [{ name: product.category.name, path: `/c/${product.category.slug}` }] : []),
    { name: product.name, path: `/p/${product.slug}` },
  ]);

  return (
    <div className="container">
      {ld && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(ld) }} />}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(crumbs) }} />
      <nav className="breadcrumb" aria-label="breadcrumb">
        <Link href="/">Acasă</Link>
        {product.category && (
          <>
            <span className="sep">/</span>
            <Link href={`/c/${product.category.slug}`}>{product.category.name}</Link>
          </>
        )}
        <span className="sep">/</span>
        <span>{product.name}</span>
      </nav>

      <div className="product-hero" style={{ marginTop: 8 }}>
        <div className="product-gallery"><ProductImage name={product.name} brand={product.brand} src={product.image} /></div>
        <div>
          {product.brand && <div className="pbrand" style={{ fontSize: 13 }}>{product.brand}</div>}
          <h1 className="product-title">{product.name}</h1>
          {/*
            A STRIKETHROUGH IS A CLAIM ABOUT ONE OFFER'S OWN HISTORY.
            This block used to render `summary.highest` — ANOTHER MERCHANT'S price for the
            same product — struck through beside the lowest. That reads as "was 17,99, now
            12,00": a discount nobody ever gave. It is the price at a different shop.
            A range is now stated as a range, and a strike only appears when the cheapest
            shown offer carries its own genuine former price.
          */}
          <div className="price-block">
            <span className="from">cel mai mic preț</span>
            <span className="big">{formatRON(summary.lowest)}</span>
            {bestOffer && (() => {
              const d = priceDisplayFor(bestOffer);
              if (d.kind === "strike") {
                return (
                  <span className="strike" title="prețul anterior la același magazin">
                    {formatRON(d.wasBani / 100)}
                  </span>
                );
              }
              return null;
            })()}
          </div>
          {bestOffer && (() => {
            // The Omnibus 30-day figure is a LEGAL FLOOR, not a former price. It is shown,
            // labelled for what it is, and never struck through — striking it would claim a
            // discount on what may well be a price increase.
            const d = priceDisplayFor(bestOffer);
            return d.kind === "omnibus" ? (
              <div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>
                Preț minim în ultimele 30 de zile: {formatRON(d.lowBani / 100)}
              </div>
            ) : null;
          })()}
          {(() => {
            const range = priceRange(summary.lowestBani, summary.highestBani, summary.inStockCount);
            return range ? (
              <div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>{range}</div>
            ) : null;
          })()}
          {/*
            ONE COUNT, SAID THE SAME WAY EVERYWHERE ON THIS PAGE.
            This line said "1 magazine" while the table below listed four rows, because it
            reported offerCount (in stock) next to a table that renders every offer. Three
            different counts existed on one page: this one, the section heading, and the meta
            description, each with its own definition. A page that disagrees with itself is
            worse than a page with a wrong number, because the reader cannot tell which half
            to trust.
          */}
          <div className="muted" style={{ marginBottom: 10 }}>
            {bestOffer && bestOffer.pricePerUnit > 0 ? `${formatPerUnit(bestOffer.pricePerUnit, product.unit)} · ` : ""}
            {summary.inStockCount === offers.length
              ? `${offers.length} magazine`
              : `${summary.inStockCount} din ${offers.length} magazine au stoc azi`}
          </div>
          {priceInsight.atLow ? (
            <div className="save-note" style={{ marginBottom: 14 }}>🔥 Moment bun de cumpărat — preț la minimul istoric{priceInsight.belowAvgPct > 3 ? ` (cu ${Math.round(priceInsight.belowAvgPct)}% sub media perioadei)` : ""}.</div>
          ) : priceInsight.belowAvgPct > 6 ? (
            <div className="save-note muted" style={{ marginBottom: 14 }}>📉 Sub media prețului cu {Math.round(priceInsight.belowAvgPct)}%.</div>
          ) : null}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            {bestOffer && (
              <a className="btn btn-accent" href={bestOffer.url || "#"} target="_blank" rel="nofollow noopener">
                Vezi la {bestOffer.merchant.name} · {formatRON(bestOffer.price)} →
              </a>
            )}
            <AddToList slug={product.slug} name={product.name} />
            <TrackPrice slug={product.slug} name={product.name} price={summary.lowest} />
          </div>
          {/*
            THE LADDER, from the VALIDATED BulkTier rows rather than the legacy JSON column.
            `Offer.bulkTiers` (a JSON string) is populated on 247 offers; the BulkTier table
            holds 3,938 — the same fact in two places, with the gated, validated copy being
            the one that was not rendering. See docs/BACKLOG.md.
            `visibleTiers` refuses a ladder hanging off a flagged, stale or out-of-stock
            price: a discount computed against a withheld base is a made-up number wearing a
            percentage.
          */}
          {(() => {
            const withLadder = offers
              .map((o) => ({ o, ladder: visibleTiers(o) }))
              .filter((x) => x.ladder !== null)
              .sort((a, b) => a.ladder!.bestUnitBani - b.ladder!.bestUnitBani)[0];
            return withLadder ? <BulkTierTable ladder={withLadder.ladder!} /> : null;
          })()}
        </div>
      </div>

      <section className="section">
        {/*
          CARRIED BY vs PRICED TODAY. These are different facts and conflating them is what
          makes an out-of-stock row look like a price you can pay. `offerCount` is how many
          shops carry the product; `inStockCount` is how many have a price you can act on
          right now.
        */}
        <div className="section-head">
          <h2>
            {summary.inStockCount === offers.length
              ? `Prețuri în ${offers.length} magazine`
              : `Disponibil azi în ${summary.inStockCount} din ${offers.length} magazine`}
          </h2>
        </div>
        <div className="card" style={{ padding: 4 }}><OfferTable offers={offers} unit={product.unit} /></div>
        {/*
          Every item page carries the report link. A comparison site's only asset is that
          people believe the numbers, and the cheapest way to find a wrong match is to let
          the person looking at it tell us.
        */}
        <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
          Prețul nu e corect sau pagina amestecă două produse?{" "}
          <Link href="/metodologie" style={{ color: "var(--primary)" }}>raportează un preț greșit</Link>
        </p>
      </section>

      <section className="section">
        <div className="section-head"><h2>Evoluția prețurilor</h2></div>
        <div className="card chart-card">
          <PriceHistoryChart dates={chartDates} series={chartSeries} />
          <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>Treci cu mouse-ul peste grafic pentru prețul fiecărui magazin.</p>
        </div>
      </section>

      {alternatives.length > 0 && (
        <section className="section">
          <div className="section-head"><h2>🔄 Alternative similare</h2></div>
          <p className="muted" style={{ marginTop: -8, marginBottom: 14 }}>Produse de același tip și mărime — poate le găsești mai ieftin sau în alt magazin.</p>
          <div className="grid-products">
            {alternatives.map((a) => <ProductCard key={a.id} p={a} />)}
          </div>
        </section>
      )}
      <div style={{ height: 24 }} />
    </div>
  );
}
