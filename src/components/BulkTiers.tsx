import { formatRON } from "@/lib/format";

/** Renders DCNeu-style quantity discount tiers (JSON [{qty,price}]). */
export function BulkTiers({ tiers, store }: { tiers: string | null | undefined; store: string }) {
  if (!tiers) return null;
  let parsed: { qty: number; price: number }[] = [];
  try {
    parsed = JSON.parse(tiers);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length < 2) return null;
  const base = parsed[0]?.price ?? 0;

  return (
    <div className="card" style={{ padding: 14, marginTop: 16 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>🏷️ Reduceri pe cantitate — {store}</div>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Cumperi mai multe, plătești mai puțin pe bucată.</p>
      <table className="admin-table">
        <thead><tr><th>Cantitate</th><th>Preț / buc</th><th>Economie</th></tr></thead>
        <tbody>
          {parsed.map((t, i) => (
            <tr key={i}>
              <td>{t.qty === 1 ? "1 buc" : `${t.qty}+ buc`}</td>
              <td style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{formatRON(t.price)}</td>
              <td className="muted">{base > 0 && t.price < base ? `−${Math.round((1 - t.price / base) * 100)}%` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
