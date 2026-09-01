import Link from "next/link";
import { notFound } from "next/navigation";
import { AddToList } from "@/components/AddToList";
import { BulkTiers } from "@/components/BulkTiers";
import { OfferTable } from "@/components/OfferTable";
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
  const description = `Compară prețurile pentru ${data.product.name} la ${data.offers.length} magazine. Cel mai mic preț: ${formatRON(data.summary.lowest)}.`;
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
          <div className="price-block">
            <span className="from">cel mai mic preț</span>
            <span className="big">{formatRON(summary.lowest)}</span>
            {summary.savings > 0 && <span className="strike">{formatRON(summary.highest)}</span>}
          </div>
          <div className="muted" style={{ marginBottom: 10 }}>
            {bestOffer && bestOffer.pricePerUnit > 0 ? `${formatPerUnit(bestOffer.pricePerUnit, product.unit)} · ` : ""}
            {summary.offerCount} magazine
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
          {(() => {
            const t = offers.find((o) => o.bulkTiers && o.bulkTiers !== "[]");
            return t ? <BulkTiers tiers={t.bulkTiers} store={t.merchant.name} /> : null;
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
            {summary.inStockCount === summary.offerCount
              ? `Prețuri în ${summary.offerCount} magazine`
              : `Disponibil azi în ${summary.inStockCount} din ${summary.offerCount} magazine`}
          </h2>
        </div>
        <div className="card" style={{ padding: 4 }}><OfferTable offers={offers} unit={product.unit} /></div>
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
