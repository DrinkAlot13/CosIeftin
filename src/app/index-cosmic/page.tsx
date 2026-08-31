// Indexul CoșMic — the public basket-inflation page.
// A fixed 15-item Romanian basket, priced daily at the cheapest available offer.
// This is both the retention hook (compare your own basket to the national number)
// and the press hook (a quotable monthly figure that links back here).
import Link from "next/link";
import { computeCosmicIndex, getIndexTrend } from "@/lib/cosmic-index";
import { formatRON } from "@/lib/format";

// prices change once a night, so regenerate hourly at most
export const revalidate = 3600;

export const metadata = {
  title: "Indexul CoșMic — cât costă coșul de bază în România",
  description:
    "Un coș fix de 15 produse de bază (lapte, pâine, ouă, ulei, făină…), evaluat zilnic la cel mai mic preț disponibil în magazinele din România.",
};

export default async function IndexPage() {
  const [idx, trend] = await Promise.all([computeCosmicIndex(), getIndexTrend()]);
  const month = trend.monthChangePct;

  return (
    <div className="container">
      <div className="section" style={{ paddingBottom: 4 }}>
        <h1 style={{ fontSize: 28 }}>Indexul CoșMic</h1>
        <p className="muted" style={{ maxWidth: 620 }}>
          Un coș fix de {idx.of} produse de bază, evaluat în fiecare zi la <b>cel mai mic preț</b> găsit
          în magazinele urmărite de noi. Nu e un preț dintr-un singur magazin — e cât ar plăti cineva
          care cumpără fiecare produs de unde e cel mai ieftin.
        </p>
      </div>

      <div className="result-cards" style={{ marginTop: 8 }}>
        <div className="card result-card best">
          <div className="rc-label">🧺 Coșul de bază azi</div>
          <div className="rc-total">{formatRON(idx.total)}</div>
          <div className="muted">
            {idx.covered}/{idx.of} produse găsite · {idx.computedAt.toLocaleDateString("ro-RO")}
          </div>
        </div>
        {month != null && (
          <div className="card result-card">
            <div className="rc-label">📅 Față de acum o lună</div>
            <div className="rc-total">
              {month > 0 ? "+" : ""}
              {month.toFixed(1)}%
            </div>
            <div className="muted">{month > 0 ? "coșul s-a scumpit" : "coșul s-a ieftinit"}</div>
          </div>
        )}
        {trend.series.length > 1 && trend.changePct != null && (
          <div className="card result-card">
            <div className="rc-label">📈 De când măsurăm</div>
            <div className="rc-total">
              {trend.changePct > 0 ? "+" : ""}
              {trend.changePct.toFixed(1)}%
            </div>
            <div className="muted">din {trend.series[0].day}</div>
          </div>
        )}
      </div>

      {trend.series.length < 2 && (
        <div className="pill-note" style={{ marginTop: 14 }}>
          Seria istorică se construiește zilnic — procentele apar după câteva zile de măsurători.
        </div>
      )}

      <div className="card" style={{ overflowX: "auto", marginTop: 18 }}>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Produs</th>
              <th>Cel mai mic preț</th>
              <th>Magazin</th>
              <th>Produsul găsit</th>
            </tr>
          </thead>
          <tbody>
            {idx.lines.map((l) => (
              <tr key={l.key}>
                <td style={{ fontWeight: 600 }}>{l.label}</td>
                <td style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
                  {l.price != null ? formatRON(l.price) : "—"}
                </td>
                <td className="muted">{l.storeName ?? "—"}</td>
                <td className="muted" style={{ fontSize: 13 }}>
                  {l.productSlug ? (
                    <Link href={`/p/${l.productSlug}`}>{l.productName}</Link>
                  ) : (
                    "nu am găsit un produs potrivit"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section" style={{ paddingTop: 18 }}>
        <p className="muted" style={{ fontSize: 13.5, maxWidth: 640 }}>
          <b>Metodologie:</b> fiecare linie este normalizată la mărimea de referință a ambalajului
          (preț pe kg/L/bucată × mărimea din coș), deci un pachet de 500 g și unul de 1 kg se compară
          corect. Folosim doar oferte în stoc, fără prețuri marcate ca suspecte de verificările noastre
          automate. Prețurile de livrare pot include adaos față de raft.
        </p>
        <p style={{ marginTop: 10 }}>
          <Link className="btn btn-primary" href="/lista">
            Fă-ți propriul coș →
          </Link>
        </p>
      </div>
    </div>
  );
}
