import { StoreTypeBadge } from "@/components/StoreTypeBadge";
import { AVAILABILITY_LABELS, formatDate, formatPerUnit, formatRON } from "@/lib/format";
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
                  {isBest && (
                    <div style={{ marginTop: 4 }}>
                      <span className="badge badge-best">✓ Cel mai mic preț</span>
                    </div>
                  )}
                </td>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>{formatPerUnit(o.pricePerUnit, unit)}</td>
                <td>
                  <a className={isBest ? "btn btn-accent" : "btn btn-outline"} href={o.url || "#"} target="_blank" rel="nofollow noopener">
                    La magazin →
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
