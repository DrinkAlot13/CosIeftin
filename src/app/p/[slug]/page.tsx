import Link from "next/link";
import { notFound } from "next/navigation";
import { AddToList } from "@/components/AddToList";
import { OfferTable } from "@/components/OfferTable";
import { PriceHistoryChart } from "@/components/PriceHistoryChart";
import { ProductImage } from "@/components/ProductImage";
import { formatPerUnit, formatRON } from "@/lib/format";
import { getItemPage } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const data = await getItemPage(params.slug);
  if (!data) return { title: "Produs" };
  return {
    title: data.product.name,
    description: `Compară prețurile pentru ${data.product.name}. Cel mai mic preț: ${formatRON(data.summary.lowest)}.`,
  };
}

export default async function ItemPage({ params }: { params: { slug: string } }) {
  const data = await getItemPage(params.slug);
  if (!data) notFound();
  const { product, offers, summary, bestOffer } = data;

  const dateSet = new Set<string>();
  for (const o of offers) for (const h of o.history) dateSet.add(h.recordedAt.toISOString().slice(0, 10));
  const chartDates = [...dateSet].sort();
  const chartSeries = offers.map((o) => {
    const byDate = new Map(o.history.map((h) => [h.recordedAt.toISOString().slice(0, 10), h.price]));
    return { name: o.merchant.name, colorIndex: ((o.merchant.id - 1) % 8) + 1, prices: chartDates.map((d) => byDate.get(d) ?? null) };
  });

  return (
    <div className="container">
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
          <div className="muted" style={{ marginBottom: 14 }}>
            {bestOffer && bestOffer.pricePerUnit > 0 ? `${formatPerUnit(bestOffer.pricePerUnit, product.unit)} · ` : ""}
            {summary.offerCount} magazine
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            {bestOffer && (
              <a className="btn btn-accent" href={bestOffer.url || "#"} target="_blank" rel="nofollow noopener">
                Vezi la {bestOffer.merchant.name} · {formatRON(bestOffer.price)} →
              </a>
            )}
            <AddToList slug={product.slug} name={product.name} />
          </div>
        </div>
      </div>

      <section className="section">
        <div className="section-head"><h2>Prețuri în {summary.offerCount} magazine</h2></div>
        <div className="card" style={{ padding: 4 }}><OfferTable offers={offers} unit={product.unit} /></div>
      </section>

      <section className="section">
        <div className="section-head"><h2>Evoluția prețurilor</h2></div>
        <div className="card chart-card">
          <PriceHistoryChart dates={chartDates} series={chartSeries} />
          <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>Treci cu mouse-ul peste grafic pentru prețul fiecărui magazin.</p>
        </div>
      </section>
      <div style={{ height: 24 }} />
    </div>
  );
}
