import { StoreTypeBadge } from "@/components/StoreTypeBadge";
import { DELIVERY_PLATFORM_LABEL, isDeliveryPlatform } from "@/lib/platform/visibility";
import { AVAILABILITY_LABELS, formatDate, formatPerUnit, formatRON } from "@/lib/format";
import { cardSavingBani, loyaltyLabel, requiresCard, shelfLabel, withCardPhrase, LOYALTY_BADGE } from "@/lib/loyalty";
import type { OfferRow } from "@/lib/queries";

/** Per-chain price table for one item, cheapest highlighted, unit price shown. */
export function OfferTable({ offers, unit }: { offers: OfferRow[]; unit: string }) {
  const bestInStock = offers.find((o) => o.availability === "in stock");
  const bestId = bestInStock?.id;

  return (
    <div className="offers-scroll">
      <table className="offers">
        <thead>
          <tr>
            <th>Magazin</th>
            <th className="hide-sm">Disponibilitate</th>
            <th>Preț</th>
            <th>Preț/unitate</th>
            <th aria-label="Acțiune" />
          </tr>
        </thead>
        <tbody>
          {offers.map((o) => {
            const isBest = o.id === bestId;
            const oos = o.availability !== "in stock";
            return (
              <tr key={o.id} className={isBest ? "best" : undefined}>
                <td>
                  <span className="m-name">{o.merchant.name}</span>
                  <div style={{ marginTop: 3 }}><StoreTypeBadge type={o.merchant.storeType} /></div>
                  {/*
                    A PLATFORM PRICE THAT IS SHOWN AT ALL MUST SAY WHAT IT IS. These rows are
                    excluded by default and only appear behind ?dp=1, but the moment one is on
                    screen next to shelf prices it needs to carry its own explanation — measured
                    median markup is +11.5%, so it is not the same number as the row above it.
                  */}
                  {isDeliveryPlatform(o) && (
                    <div style={{ marginTop: 3 }}>
                      <span className="badge" title={DELIVERY_PLATFORM_LABEL} style={{ whiteSpace: "nowrap" }}>
                        🛵 {DELIVERY_PLATFORM_LABEL}
                      </span>
                    </div>
                  )}
                  {o.packLabel && <div className="m-net">{o.packLabel}</div>}
                </td>
                <td className="hide-sm">
                  <span className={oos ? "badge badge-oos" : "muted"}>{AVAILABILITY_LABELS[o.availability] ?? "În stoc"}</span>
                  {/*
                    AN OUT-OF-STOCK ROW STAYS, WITH THE DATE WE LAST SAW IT PRICED.
                    Out-of-stock dominates the comparability loss - 3,028 products - and it is
                    not a pipeline failure: Freshful and Sezamo run limited assortments and the
                    big online catalogs go out of stock constantly. Dropping those rows would
                    show fewer shops than actually carry the product.
                    So the row cannot be the headline and cannot win "cel mai mic preț", but it
                    is still shown, with WHEN that price was true. Without the date it reads as
                    a current price the shopper simply cannot buy, which is the dishonest
                    version of the same table.
                  */}
                  {oos && o.lastObservedAt && (
                    <div className="m-net" style={{ marginTop: 2, fontSize: 11 }}>
                      ultimul preț {formatDate(o.lastObservedAt)}
                    </div>
                  )}
                </td>
                <td>
                  <span className={oos ? "o-price o-oos" : "o-price"}>{formatRON(o.price)}</span>
                  {/*
                    A CARD PRICE THAT IS SHOWN AT ALL MUST SAY SO — the same rule as the
                    delivery-platform badge above, and the more dangerous direction of it. A
                    platform price is marked UP, so an unlabelled one merely looks expensive; a
                    card price is marked DOWN, so an unlabelled one WINS a comparison it should
                    not win. Kaufland's own scraper predicted this in a comment — "an unlabeled
                    card price would silently undercut every other store" — and 65 offers carried
                    one with nothing saying it.
                  */}
                  {requiresCard(o) && (
                    <div style={{ marginTop: 4 }}>
                      <span className="badge" style={{ whiteSpace: "nowrap" }} title="Acest preț se obține doar cu cardul de fidelitate al magazinului.">
                        {LOYALTY_BADGE} {loyaltyLabel(o.merchant.slug)}
                      </span>
                    </div>
                  )}
                  {/* A cheaper card price ALONGSIDE the shelf price: the shelf figure is the one
                      shown, and the card figure is offered as the extra it is. */}
                  {cardSavingBani(o) != null && (
                    <div className="m-net" style={{ marginTop: 3, fontSize: 11 }}>
                      {LOYALTY_BADGE} {formatRON((o.loyaltyPriceBani as number) / 100)} {withCardPhrase(o.merchant.slug)}
                      {" · "}{formatRON(o.price)} {shelfLabel(o.merchant.slug)}
                    </div>
                  )}
                  {isBest && (
                    <div style={{ marginTop: 4 }}>
                      <span className="badge badge-best">✓ Cel mai mic preț</span>
                    </div>
                  )}
                </td>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>{formatPerUnit(o.pricePerUnit, unit)}</td>
                <td>
                  {/*
                    A BUTTON MAY NOT PROMISE A LINK THAT DOES NOT EXIST. Two sources publish no
                    per-product page — the Kaufland flyer and the Glovo storefront — and for
                    their rows `productUrl` is null and `url` is a listing or the shop front.
                    Labelling that "La magazin" sends the shopper to a homepage to hunt, which
                    is the display-side version of the rule that an absent link must be VISIBLY
                    null rather than silently pointing at a generic page.
                  */}
                  <a
                    className={isBest ? "btn btn-accent" : "btn btn-outline"}
                    href={o.url || "#"}
                    target="_blank"
                    rel="nofollow noopener"
                    title={o.productUrl ? undefined : "Magazinul nu publică o pagină pentru fiecare produs — te ducem la magazin, unde îl poți căuta."}
                  >
                    {o.productUrl ? "La magazin →" : "Vezi magazinul →"}
                  </a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
