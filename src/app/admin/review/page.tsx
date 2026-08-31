// Match-review queue. Everything the automatic gates found suspicious lands here instead
// of silently going live — a low-confidence match, an implausible price jump, an outlier
// against the cross-store median.
//
// A decision made here is stored as a MatchOverride, which SURVIVES a full rebuild. That's
// the whole point: corrections must never have to be re-learned.
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatRON } from "@/lib/format";
import { ReviewActions } from "@/components/ReviewActions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Verificare potriviri", robots: { index: false } };

export default async function ReviewPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin/review");
  if (!user.isAdmin) {
    return (
      <div className="container">
        <div className="empty">
          <h1 style={{ fontSize: 24 }}>Acces restricționat</h1>
          <Link className="btn btn-primary" href="/">Înapoi acasă</Link>
        </div>
      </div>
    );
  }

  const [flagged, counts, overrides] = await Promise.all([
    prisma.offer.findMany({
      where: { flagged: true },
      include: {
        product: { select: { name: true, slug: true, brand: true, unit: true, unitSize: true } },
        merchant: { select: { name: true } },
      },
      orderBy: [{ matchScore: "asc" }, { id: "desc" }],
      take: 100,
    }),
    prisma.offer.count({ where: { flagged: true } }),
    prisma.matchOverride.count(),
  ]);

  return (
    <div className="container">
      <div className="section" style={{ paddingBottom: 8 }}>
        <h1 style={{ fontSize: 26 }}>Verificare potriviri</h1>
        <p className="muted" style={{ fontSize: 13.5 }}>
          {counts} oferte semnalate · {overrides} decizii salvate (rezistă la reconstrucția bazei) ·
          se afișează primele 100, cele mai nesigure întâi.
        </p>
        <p className="muted" style={{ fontSize: 13 }}>
          <Link href="/admin">← Panou admin</Link>
        </p>
      </div>

      {flagged.length === 0 ? (
        <div className="pill-note">✅ Nimic de verificat — toate potrivirile au trecut verificările automate.</div>
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Produs din catalog</th>
                <th>Magazin</th>
                <th>Preț</th>
                <th>Încredere</th>
                <th>Motiv</th>
                <th>Decizie</th>
              </tr>
            </thead>
            <tbody>
              {flagged.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link href={`/p/${o.product.slug}`} style={{ fontWeight: 600 }}>{o.product.name}</Link>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {o.product.brand ? `${o.product.brand} · ` : ""}{o.product.unitSize}{o.product.unit}
                    </div>
                  </td>
                  <td>
                    {o.merchant.name}
                    {o.url && (
                      <div style={{ fontSize: 12 }}>
                        <a href={o.url} target="_blank" rel="noopener noreferrer nofollow">vezi la magazin ↗</a>
                      </div>
                    )}
                  </td>
                  <td style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{formatRON(o.price)}</td>
                  <td className="mono" style={{ whiteSpace: "nowrap" }}>
                    {o.matchScore != null ? o.matchScore.toFixed(2) : "—"}
                    <div className="muted" style={{ fontSize: 11.5 }}>{o.matchedBy}</div>
                  </td>
                  <td className="muted" style={{ fontSize: 12.5, maxWidth: 220 }}>{o.flagReason ?? "—"}</td>
                  <td><ReviewActions offerId={o.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
