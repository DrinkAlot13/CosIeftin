import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { getAdminStats } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin", robots: { index: false } };

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin");
  if (!user.isAdmin) {
    return (
      <div className="container">
        <div className="empty">
          <h1 style={{ fontSize: 24 }}>Acces restricționat</h1>
          <p>Acest panou este disponibil doar administratorilor.</p>
          <Link className="btn btn-primary" href="/" style={{ marginTop: 12 }}>Înapoi acasă</Link>
        </div>
      </div>
    );
  }
  const s = await getAdminStats();

  return (
    <div className="container">
      <div className="section" style={{ paddingBottom: 8 }}>
        <h1 style={{ fontSize: 26 }}>Panou admin</h1>
        <p className="muted" style={{ fontSize: 13.5 }}>
          Ultima actualizare a prețurilor: {s.lastUpdated ? formatDate(s.lastUpdated) : "—"}
        </p>
      </div>

      <div className="kpis">
        {[
          { num: s.products, lbl: "Produse" },
          { num: s.offers, lbl: "Prețuri (oferte)" },
          { num: s.chains, lbl: "Magazine" },
        ].map((k) => (
          <div key={k.lbl} className="card kpi">
            <div className="num">{k.num}</div>
            <div className="lbl">{k.lbl}</div>
          </div>
        ))}
      </div>

      <section className="section">
        <div className="section-head"><h2>Acoperire per magazin</h2></div>
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="admin-table">
            <thead><tr><th>Magazin</th><th>Produse cu preț</th></tr></thead>
            <tbody>
              {s.merchantRows.map((m) => (
                <tr key={m.id}>
                  <td style={{ fontWeight: 600 }}>{m.name}</td>
                  <td>{m._count.offers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div style={{ height: 32 }} />
    </div>
  );
}
