// "Preț la cantitate" — the quantity ladder DCNeu prints on its own product cards.
//
// This is a discounter. The ladder IS the offer, and a page that shows only the single-unit
// price is showing the least attractive number on the card. 5,024 of these rows have been in
// the database for several sessions with nothing rendering them.
import { formatRON } from "@/lib/format";
import type { Ladder } from "@/lib/bulk-tiers";
import { discountBpOf } from "@/lib/bulk-tiers";

/**
 * `minQuantity` counts PIECES, always — "buy 4 or more", never "buy 4 litres or more".
 *
 * Rendering the product's measurement unit here produced "de la 2 l" on a 100 ml aftershave,
 * which reads as a two-litre minimum on a bottle that holds a tenth of that. The measurement
 * unit belongs to the product; the ladder's threshold belongs to the checkout.
 */
export function BulkTierTable({ ladder }: { ladder: Ladder }) {
  const unitWord = "buc";
  const rows = [
    { qty: 1, unitBani: ladder.baseBani, discountBp: 0 },
    ...ladder.rungs.map((r) => ({
      qty: r.minQuantity,
      unitBani: r.unitPriceBani,
      // Recomputed against the base we are actually rendering, never read from the stored
      // basis points: a stored discount and a re-derived one disagreeing is exactly the
      // class of bug this project keeps finding.
      discountBp: discountBpOf(ladder.baseBani, r.unitPriceBani),
    })),
  ];
  const bestQty = rows[rows.length - 1].qty;

  return (
    <div className="card" style={{ padding: 12, marginTop: 12 }}>
      <h3 style={{ margin: "0 0 2px", fontSize: 15 }}>Preț la cantitate</h3>
      <p className="muted" style={{ margin: "0 0 10px", fontSize: 12.5 }}>
        Prețul pe bucată scade dacă iei mai multe. Prețurile sunt cele afișate de magazin.
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
            <th style={{ padding: "5px 8px 5px 0", fontWeight: 600 }}>Cantitate</th>
            <th style={{ padding: "5px 8px", textAlign: "right", fontWeight: 600 }}>Preț / {unitWord}</th>
            <th style={{ padding: "5px 0 5px 8px", textAlign: "right", fontWeight: 600 }}>Economisești</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isBest = r.qty === bestQty;
            return (
              <tr
                key={r.qty}
                style={{
                  borderBottom: "1px solid var(--border)",
                  fontWeight: isBest ? 700 : 400,
                  background: isBest ? "rgba(46,160,67,0.09)" : undefined,
                }}
              >
                <td style={{ padding: "6px 8px 6px 0" }}>
                  {r.qty === 1 ? `1 ${unitWord}` : `de la ${r.qty} ${unitWord}`}
                </td>
                <td style={{ padding: "6px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {formatRON(r.unitBani / 100)}
                </td>
                <td
                  style={{
                    padding: "6px 0 6px 8px",
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                    color: r.discountBp > 0 ? "var(--primary)" : undefined,
                  }}
                >
                  {r.discountBp > 0 ? `${(r.discountBp / 100).toFixed(0)}%` : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Compact listing badge: "de la 6,61 lei/buc la 6+". */
export function BulkTierBadge({ ladder }: { ladder: Ladder }) {
  const unitWord = "buc";
  return (
    <span
      className="badge"
      title={`Preț la cantitate: ${(ladder.bestDiscountBp / 100).toFixed(0)}% mai ieftin de la ${ladder.bestFromQty} ${unitWord}`}
      style={{ background: "rgba(46,160,67,0.12)", color: "var(--primary)", whiteSpace: "nowrap" }}
    >
      de la {formatRON(ladder.bestUnitBani / 100)}/{unitWord} la {ladder.bestFromQty}+
    </span>
  );
}
