// A public leaderboard of real contributions — confirmed equivalence suggestions and resolved
// product reports. Deliberately counts only REVIEWED outcomes (CONFIRMED / RESOLVED), never raw
// submission counts: ranking on volume alone rewards whoever submits the most, not whoever is
// actually right, and this project has spent the whole session on the difference between those.
import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Contribuitori",
  description: "Cumpărătorii care au ajutat să corectăm o echivalență sau un preț greșit.",
};

export default async function ContribuitoriPage() {
  const [suggestions, reports] = await Promise.all([
    prisma.equivalenceSuggestion.findMany({
      where: { status: "CONFIRMED" },
      select: { userId: true, user: { select: { username: true } } },
    }),
    prisma.productReport.findMany({
      where: { status: "RESOLVED", userId: { not: null } },
      select: { userId: true, user: { select: { username: true } } },
    }),
  ]);

  const byUser = new Map<string, { confirmed: number; resolved: number }>();
  for (const s of suggestions) {
    const e = byUser.get(s.user.username) ?? { confirmed: 0, resolved: 0 };
    e.confirmed++;
    byUser.set(s.user.username, e);
  }
  for (const r of reports) {
    if (!r.user) continue;
    const e = byUser.get(r.user.username) ?? { confirmed: 0, resolved: 0 };
    e.resolved++;
    byUser.set(r.user.username, e);
  }
  const ranked = [...byUser.entries()]
    .map(([username, e]) => ({ username, ...e, total: e.confirmed + e.resolved }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 50);

  return (
    <div className="container">
      <nav className="breadcrumb" aria-label="breadcrumb">
        <Link href="/">Acasă</Link>
        <span className="sep">/</span>
        <span>Contribuitori</span>
      </nav>
      <div className="section-head" style={{ marginTop: 8 }}>
        <h1 style={{ fontSize: 26 }}>Contribuitori</h1>
      </div>
      <p className="muted" style={{ marginTop: -4, maxWidth: 640, lineHeight: 1.6 }}>
        Numărăm doar ce s-a confirmat — o echivalență propusă și confirmată, un preț greșit
        semnalat și rezolvat. Nu numărăm câte propuneri a trimis cineva, ca să nu răsplătim
        volumul în locul faptului că a avut dreptate.
      </p>
      {ranked.length === 0 ? (
        <div className="empty">Încă nimic confirmat. Prima contribuție apare aici.</div>
      ) : (
        <div className="card" style={{ overflowX: "auto", marginTop: 12 }}>
          <table className="admin-table">
            <thead><tr><th></th><th>Cumpărător</th><th>Echivalențe confirmate</th><th>Prețuri corectate</th><th>Total</th></tr></thead>
            <tbody>
              {ranked.map((r, i) => (
                <tr key={r.username}>
                  <td className="muted">{i + 1}</td>
                  <td style={{ fontWeight: 600 }}>{r.username}</td>
                  <td>{r.confirmed}</td>
                  <td>{r.resolved}</td>
                  <td style={{ fontWeight: 700 }}>{r.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ height: 32 }} />
    </div>
  );
}
