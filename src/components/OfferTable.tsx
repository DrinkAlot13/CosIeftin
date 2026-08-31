import { StoreTypeBadge } from "@/components/StoreTypeBadge";
import { AVAILABILITY_LABELS, formatPerUnit, formatRON } from "@/lib/format";
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
