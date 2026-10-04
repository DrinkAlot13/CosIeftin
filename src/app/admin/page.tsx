import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { getAdminStats } from "@/lib/queries";
import { prisma } from "@/lib/db";

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
  // The sub-pages existed and nothing linked to them, so the review queue and the refused
  // prices were only reachable by typing the URL. A queue nobody can find is not a queue.
  const [pendingMatches, openAnomalies, pendingSuggestions, openReports] = await Promise.all([
    prisma.pendingMatch.count({ where: { resolved: false } }),
    prisma.priceAnomaly.count({ where: { resolved: false } }),
    prisma.equivalenceSuggestion.count({ where: { status: "PENDING" } }),
    prisma.productReport.count({ where: { status: "OPEN" } }),
  ]);

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
        <div className="section-head"><h2>Unelte</h2></div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {[
            { href: "/admin/health", label: "Sănătatea scraperelor", hint: "a găsit mai puțin, sau nu a putut citi?" },
            { href: "/admin/matches", label: "Potriviri de verificat", hint: `${pendingMatches} în așteptare`, badge: pendingMatches },
            { href: "/admin/anomalies", label: "Prețuri refuzate", hint: `${openAnomalies} nerezolvate`, badge: openAnomalies },
            { href: "/admin/review", label: "Revizuire", hint: "produse semnalate" },
            { href: "/admin/stats", label: "Statistici", hint: "adâncimea prețurilor, per magazin, unde lipsesc potrivirile" },
            { href: "/admin/logs", label: "Jurnale nightly", hint: "ce a scris fiecare rulare — descărcabile" },
            { href: "/admin/soak", label: "Raport soak", hint: "ultimele 14 nopți, dintr-o privire" },
            { href: "/admin/equivalence-suggestions", label: "Sugestii de echivalență", hint: `${pendingSuggestions} în așteptare`, badge: pendingSuggestions },
            { href: "/admin/product-reports", label: "Rapoarte produse", hint: `${openReports} deschise`, badge: openReports },
          ].map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="card"
              style={{ padding: 14, minWidth: 210, flex: "1 1 210px", textDecoration: "none" }}
            >
              <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                {t.label}
                {t.badge ? (
                  <span style={{ background: "var(--primary)", color: "#fff", borderRadius: 999, padding: "1px 8px", fontSize: 12 }}>
                    {t.badge}
                  </span>
                ) : null}
              </div>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>{t.hint}</div>
            </Link>
          ))}
        </div>
      </section>

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
