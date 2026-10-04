import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AddToList } from "@/components/AddToList";
import { AutoAddFromQuery } from "@/components/AutoAddFromQuery";
import { OfferTable } from "@/components/OfferTable";
import { BulkTierTable } from "@/components/BulkTierTable";
import { visibleTiers } from "@/lib/bulk-tiers";
import { priceDisplayFor, priceRange } from "@/lib/reference-price";
import { PriceHistoryChart } from "@/components/PriceHistoryChart";
import { PriceHistoryExport } from "@/components/PriceHistoryExport";
import { PriceStoryPanel } from "@/components/PriceStoryPanel";
import { spanLabelRo } from "@/lib/price-story";
import { ProductCard } from "@/components/ProductCard";
import { FavoriteHeart } from "@/components/FavoriteHeart";
import { ProductImage } from "@/components/ProductImage";
import { TrackPrice } from "@/components/TrackPrice";
import { SuggestEquivalent } from "@/components/SuggestEquivalent";
import { ReportProblem } from "@/components/ReportProblem";
import { formatPerUnit, formatRON } from "@/lib/format";
import { isCurrent } from "@/lib/pricing";
import { getAlternatives, getClassEquivalents, getItemPage } from "@/lib/queries";
import { DELIVERY_PLATFORM_NOTE, isDeliveryPlatform, showDeliveryPlatform } from "@/lib/platform/visibility";
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

export default async function ItemPage({
  params, searchParams,
}: { params: { slug: string }; searchParams?: Record<string, string | string[] | undefined> }) {
  // ?dp=1 opts THIS request into delivery-platform rows and nothing else. Default is off.
  const data = await getItemPage(params.slug, showDeliveryPlatform(searchParams ?? null));
  if (!data) notFound();
  const { product, offers, summary, bestOffer, story } = data;
  // A shop's OWN brand cannot be sold anywhere else, so "one shop" is the product's nature
  // rather than a gap in our coverage. Read from the attribute the substitution engine already
  // uses, so the page and the optimizer cannot disagree about which products are private label.
  const isOwnBrand = product.attributes.some((a) => a.value === "true");
  const onlyShopName = offers.filter((o) => isCurrent(o as never)).map((o) => o.merchant.name)[0] ?? null;
  const alternatives = await getAlternatives(product.id);
  const equivalents = await getClassEquivalents(product.id);

  const dateSet = new Set<string>();
  for (const o of offers) for (const h of o.history) dateSet.add(h.recordedAt.toISOString().slice(0, 10));
  const chartDates = [...dateSet].sort();
  const chartSeries = offers.map((o) => {
    const byDate = new Map(o.history.map((h) => [h.recordedAt.toISOString().slice(0, 10), h.price]));
    return { name: o.merchant.name, colorIndex: ((o.merchant.id - 1) % 8) + 1, prices: chartDates.map((d) => byDate.get(d) ?? null) };
  });

  // Shelf offers and platform offers are counted apart, everywhere. `summary` already ignores
  // platform rows (isCurrent excludes them), so this only affects what is DISPLAYED.
  const platformOffers = offers.filter((o) => isDeliveryPlatform(o as never));
  const platformInStock = platformOffers.filter((o) => o.availability === "in stock").length;
  const shelfOfferCount = offers.length - platformOffers.length;

  // The retailer's OWN Omnibus 30-day figure, taken from the offer whose price we are showing.
  // Carried through so the panel can label it as THEIRS. No discount is computed from it.
  const refOffer = offers.find((o) => isCurrent(o as never) && o.referencePriceBani && o.referencePriceBani > 0);
  const retailerReference = refOffer?.referencePriceBani
    ? { bani: refOffer.referencePriceBani, merchantName: refOffer.merchant.name }
    : null;

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
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <h1 className="product-title" style={{ flex: 1, minWidth: 0 }}>{product.name}</h1>
            <FavoriteHeart productId={product.id} size={26} />
          </div>
          {/*
            A STRIKETHROUGH IS A CLAIM ABOUT ONE OFFER'S OWN HISTORY.
            This block used to render `summary.highest` — ANOTHER MERCHANT'S price for the
            same product — struck through beside the lowest. That reads as "was 17,99, now
            12,00": a discount nobody ever gave. It is the price at a different shop.
            A range is now stated as a range, and a strike only appears when the cheapest
            shown offer carries its own genuine former price.
          */}
          {/* "cel mai mic preț 0,00 RON" IS NOT A PRICE. `summary.lowest` is 0 when nothing we
              can stand behind is in stock, and rendering that as money reads as "free". It only
              became visible once platform rows started rendering on products whose ONLY in-stock
              price is a Glovo one — 3,142 products are in that state (audit:platform). Those
              pages now say what is true: we have no shelf price today, and the Glovo prices are
              listed below under their own label. */}
          <div className="price-block">
            {summary.hasCurrentPrice ? (
              <>
                <span className="from">cel mai mic preț</span>
                <span className="big">{formatRON(summary.lowest)}</span>
              </>
            ) : (
              <>
                <span className="from">niciun preț de raft azi</span>
                <span className="big" style={{ fontSize: 22 }}>
                  {platformInStock > 0 ? "doar prin Glovo" : "—"}
                </span>
              </>
            )}
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
          {/*
            SGR: PRICE AND DEPOSIT, SEPARATELY.
            The deposit is not part of the price - it comes back when the container does - but
            it IS money handed over at the till, and it differs between the products on this
            page: a 6 x 0.33 l pack carries 3,00 lei and a 2 l bottle carries 0,50. Folding it
            into the price would misstate the price; hiding it misstates the bill.
            It deliberately does NOT affect the unit price or the "cel mai mic preț" ranking.
          */}
          {bestOffer?.depositBani != null && bestOffer.containerCount != null && (
            <div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>
              + garanție SGR {formatRON((bestOffer.depositBani * bestOffer.containerCount) / 100)}
              {bestOffer.containerCount > 1 ? ` (${bestOffer.containerCount} × ${formatRON(bestOffer.depositBani / 100)})` : ""}
              {" · "}
              <b>preț + garanție {formatRON(((bestOffer.priceBani ?? Math.round(bestOffer.price * 100)) + bestOffer.depositBani * bestOffer.containerCount) / 100)}</b>
              {" — garanția se returnează când duci ambalajul înapoi"}
            </div>
          )}
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
          {/* THE MERCHANT COUNT COUNTS SHELF SHOPS, AND NAMES PLATFORM ONES SEPARATELY.
              Folding "2 magazine + 1 prin Glovo" into "3 magazine" would let a marked-up
              delivery price pad the number a shopper reads as cross-shop coverage. They are
              different kinds of availability and the sentence says so. */}
          <div className="muted" style={{ marginBottom: 10 }}>
            {bestOffer && bestOffer.pricePerUnit > 0 ? `${formatPerUnit(bestOffer.pricePerUnit, product.unit)} · ` : ""}
            {shelfOfferCount === 0
              ? "niciun magazin nu are preț de raft azi"
              : summary.inStockCount === shelfOfferCount
                ? `${shelfOfferCount} ${shelfOfferCount === 1 ? "magazin" : "magazine"}`
                : `${summary.inStockCount} din ${shelfOfferCount} magazine au stoc azi`}
            {platformInStock > 0 && (
              <> · <span title={DELIVERY_PLATFORM_NOTE}>🛵 {platformInStock} prin Glovo</span></>
            )}
          </div>
          {/* "Moment bun de cumpărat — preț la minimul ISTORIC" used to render here off four
              observations, with no check on how long we had actually been watching. The history
              table began 2026-08-06, so "istoric" was a claim about 35 days. The verdict now
              comes from `lib/price-story`, which states the span it measured, and the full
              reasoning sits in the panel further down rather than as a bare badge. */}
          {story.kind === "story" && story.goodTime && (
            <div className="save-note" style={{ marginBottom: 14 }}>
              🔥 Moment bun de cumpărat — prețul e la minimul observat de noi {spanLabelRo(story.observedDays)}.
            </div>
          )}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            {bestOffer && (
              <a className="btn btn-accent" href={bestOffer.url || "#"} target="_blank" rel="nofollow noopener">
                Vezi la {bestOffer.merchant.name} · {formatRON(bestOffer.price)} →
              </a>
            )}
            <AddToList slug={product.slug} name={product.name} productId={product.id} />
            {/* useSearchParams() (for the ?add=1 Telegram-alert deep link) requires a Suspense
                boundary, or it forces this whole ISR'd (revalidate = 3600) page to opt out of
                static generation at build time. Isolated to its own invisible component rather
                than folded into AddToList, which also renders inside ProductCard — many per
                page, many pages — and has no use for this. */}
            <Suspense fallback={null}>
              <AutoAddFromQuery slug={product.slug} name={product.name} productId={product.id} />
            </Suspense>
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
          {/* SHELF SHOPS AND PLATFORM SHOPS ARE COUNTED APART HERE TOO.
              `offers.length` became "every row in the table" once platform rows started
              rendering, so a product at ONE shop plus two Glovo storefronts read as
              "1 din 3 magazine" — which invites the reader to count three shops. */}
          <h2>
            {shelfOfferCount === 0
              ? `Preț doar prin Glovo (${platformInStock})`
              : summary.inStockCount === shelfOfferCount
                ? `Prețuri în ${shelfOfferCount} ${shelfOfferCount === 1 ? "magazin" : "magazine"}`
                : `Disponibil azi în ${summary.inStockCount} din ${shelfOfferCount} magazine`}
            {shelfOfferCount > 0 && platformInStock > 0 ? ` · ${platformInStock} prin Glovo` : ""}
          </h2>
        </div>
        <div className="card" style={{ padding: 4 }}><OfferTable offers={offers} unit={product.unit} /></div>
        {/* ── WHY ONE SHOP, IN WORDS.
            "1 magazine" is a number, not an explanation, and it reads as a broken site — which
            is the wrong conclusion 89% of the time. There are two genuinely different reasons a
            product sits at one shop, and they deserve different sentences:

              OWN BRAND   nobody else CAN sell it. Nothing is missing and nothing will improve.
              EVERYTHING  one shop has a price we can stand behind TODAY. That is a fact about
              ELSE        our coverage, and it may change tomorrow.

            Saying "doar un magazin" for an Auchan own-brand product implies we failed to find
            the others. Saying it for a national brand is honest. The distinction is the whole
            point of the copy. */}
        {summary.inStockCount === 1 && (
          <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
            {isOwnBrand
              ? <>ℹ️ <b>Doar {onlyShopName ?? "un magazin"}</b> vinde acest produs dintre magazinele urmărite — este marca proprie a magazinului, așa că nu are preț de comparat în altă parte.</>
              : <>ℹ️ Momentan doar un magazin are un preț pe care ne putem baza pentru acest produs. {equivalents.equivalentCount > 0 ? "Mai jos găsești produse echivalente pe care le poți compara." : "Verificăm zilnic — dacă apare în alt magazin, îl vezi aici."}</>}
          </p>
        )}
        {/*
          Every item page carries the report link. A comparison site's only asset is that
          people believe the numbers, and the cheapest way to find a wrong match is to let
          the person looking at it tell us. It used to link to /metodologie, a page ABOUT
          methodology — a dead end, not a way to tell us anything.
        */}
        <ReportProblem productSlug={product.slug} />
      </section>

      <section className="section">
        <div className="section-head"><h2>Evoluția prețurilor</h2></div>
        <div style={{ marginBottom: 14 }}>
          <PriceStoryPanel story={story} retailerReference={retailerReference} />
        </div>
        <div className="card chart-card">
          <PriceHistoryChart dates={chartDates} series={chartSeries} />
          <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>Treci cu mouse-ul peste grafic pentru prețul fiecărui magazin.</p>
          <div style={{ marginTop: 6 }}>
            <PriceHistoryExport dates={chartDates} series={chartSeries} productName={product.name} />
          </div>
        </div>
      </section>

      {/* SAME NEED, ANY SHOP.
          `getAlternatives` below finds products that look similar. This finds products the
          substitution engine would actually accept in place of this one — the equivalence
          class — and shows them PER SHOP. That distinction is the site's reason to exist: if
          Auchan sells eggs L 10-pack and Mega sells a different brand of eggs L 10-pack, both
          belong here, priced, with the shop named. */}
      {/* THE HEADING IS CHOSEN FROM THE DATA, not asserted. `crenvursti-450g` had three live
          members and all three were at Mega Image, so "la alte magazine" was printed over a
          table in which every row was the shop the reader was already looking at. The old
          guard counted ROWS, and rows are per (product, shop) — two rows can be one product at
          two shops, or two products at one. `otherShopCount` counts the thing the heading
          claims. Where equivalents exist only at the same shop the heading says so, because
          "a cheaper equivalent on the same shelf" is still worth showing and is a different
          sentence. */}
      {equivalents.equivalentCount > 0 && (
        <section className="section">
          <div className="section-head"><h2>🔁 {equivalents.otherShopCount > 0 ? "Produse echivalente la alte magazine" : "Produse echivalente în același magazin"}</h2></div>
          <p className="muted" style={{ marginTop: -8, marginBottom: 12 }}>
            Nu sunt același produs. Sunt produse pe care le considerăm <b>echivalente</b>{equivalents.label ? <> ({equivalents.label.toLowerCase()})</> : null} —
            marcă diferită, aceeași nevoie. Sortate după prețul pe unitate.
          </p>
          <div className="card" style={{ overflowX: "auto" }}>
            <table className="admin-table">
              <thead><tr><th>Produs</th><th>Magazin</th><th className="num">Preț</th><th className="num">Preț/unitate</th></tr></thead>
              <tbody>
                {equivalents.rows.map((r, i) => (
                  <tr key={`${r.productId}-${r.merchantSlug}-${i}`} style={r.isSelf ? { background: "var(--primary-050)" } : undefined}>
                    <td>
                      <Link href={`/p/${r.slug}`} style={{ fontWeight: r.isSelf ? 700 : 500 }}>{r.name}</Link>
                      {r.isSelf && <span className="muted" style={{ fontSize: 12 }}> · produsul de mai sus</span>}
                    </td>
                    <td>{r.merchantName}</td>
                    <td className="num" style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{formatRON(r.priceBani / 100)}</td>
                    <td className="num muted" style={{ whiteSpace: "nowrap" }}>
                      {r.pricePerUnit > 0 ? formatPerUnit(r.pricePerUnit, r.unit) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {alternatives.length > 0 && (
        <section className="section">
          <div className="section-head"><h2>🔄 Alternative similare</h2></div>
          <p className="muted" style={{ marginTop: -8, marginBottom: 14 }}>Produse de același tip și mărime — poate le găsești mai ieftin sau în alt magazin.</p>
          <div className="grid-products">
            {alternatives.map((a) => <ProductCard key={a.id} p={a} />)}
          </div>
        </section>
      )}

      {/* Shown whether or not the system already found alternatives — a shopper who actually
          buys both products is evidence a catalog scan cannot produce on its own. */}
      <SuggestEquivalent productSlug={data.product.slug} />

      <div style={{ height: 24 }} />
    </div>
  );
}
