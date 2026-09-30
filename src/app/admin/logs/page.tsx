import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listNightlyLogs } from "@/lib/admin/logs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Jurnale nightly", robots: { index: false } };

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function AdminLogsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin/logs");
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

  const logs = listNightlyLogs();

  return (
    <div className="container">
      <div className="section" style={{ paddingBottom: 8 }}>
        <h1 style={{ fontSize: 26 }}>Jurnale nightly</h1>
        <p className="muted" style={{ fontSize: 13.5 }}>
          Ce a scris fiecare rulare a <code>npm run nightly</code> — scraping, potrivire,
          recalculare. Un fișier lipsă înseamnă că nightly nu a pornit deloc în acea noapte;
          un fișier care se termină brusc înseamnă că a picat, iar ultimele linii spun de ce.
        </p>
      </div>
      <section className="section">
        {logs.length === 0 ? (
          <div className="empty">
            <p>Niciun jurnal încă. Nightly nu a rulat de când a fost adăugată această pagină.</p>
          </div>
        ) : (
          <div className="card" style={{ overflowX: "auto" }}>
            <table className="admin-table">
              <thead><tr><th>Data</th><th>Mărime</th><th></th></tr></thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.filename}>
                    <td style={{ fontWeight: 600 }}>{l.date}</td>
                    <td>{formatBytes(l.bytes)}</td>
                    <td>
                      <a className="btn btn-outline" style={{ padding: "4px 12px" }} href={`/api/admin/logs?file=${l.filename}`}>
                        Descarcă
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <div style={{ height: 32 }} />
    </div>
  );
}
