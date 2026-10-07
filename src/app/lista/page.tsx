import Link from "next/link";
import { ListBuilder } from "@/components/ListBuilder";
import { BudgetBar } from "@/components/BudgetBar";
import { getStoreList } from "@/lib/queries";
import { versionedSeries, changeWithin } from "@/lib/index-series-v2";

export const dynamic = "force-dynamic";
export const metadata = { title: "Listele mele de cumpărături" };

export default async function ListaPage() {
  const [stores, series] = await Promise.all([getStoreList(), versionedSeries()]);
  // The sitewide Index's own monthly change, for context — "is this generally an expensive
  // month, or is it just this cart" — not a claim about this specific list, which is why it
  // links out to /index-cosmic rather than pretending to be a figure about this cart.
  const indexMonth = changeWithin(series.v2, 28);
  return (
    <div className="container">
      <div className="section" style={{ paddingBottom: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: 26 }}>🛒 Listele mele de cumpărături</h1>
            <p className="muted">Ține mai multe liste, alege magazinele tale și îți spunem unde e cel mai ieftin — într-un magazin sau împărțit.</p>
          </div>
          <Link href="/scanare" className="btn btn-outline" style={{ fontSize: 14, whiteSpace: "nowrap" }}>📷 Scanează</Link>
        </div>
        {indexMonth && Math.abs(indexMonth.pct) >= 0.5 && (
          <p className="muted" style={{ fontSize: 13 }}>
            {indexMonth.pct > 0 ? "📈" : "📉"} Coșul de bază CosIeftin e cu <b>{Math.abs(indexMonth.pct).toFixed(1)}%</b>{" "}
            {indexMonth.pct > 0 ? "mai scump" : "mai ieftin"} față de acum o lună — nu doar lista ta, piața în general.{" "}
            <Link href="/index-cosmic">Vezi indexul →</Link>
          </p>
        )}
      </div>
      <div className="container"><BudgetBar /></div>
      <ListBuilder stores={stores} />
      <div style={{ height: 32 }} />
    </div>
  );
}
