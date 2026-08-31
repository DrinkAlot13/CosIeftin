// Scraper health. The question this page answers is the one that was previously
// unanswerable the morning after: did the run find fewer products, or could it not READ
// the products it found? Those look identical in an offer count and are completely
// different problems.
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sănătatea scraperelor", robots: { index: false } };

const STALE_AFTER_DAYS = 14;

export default async function HealthPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin/health");
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

  const staleCutoff = new Date(Date.now() - STALE_AFTER_DAYS * 864e5);
  const merchants = await prisma.merchant.findMany({
    where: { active: true },
    select: { id: true, name: true, slug: true, priceSource: true, lastScrapeAt: true, lastOfferCount: true },
    orderBy: { name: "asc" },
  });

  const rows = await Promise.all(
    merchants.map(async (m) => {
      const [runs, offers, flagged, stale, expired, anomalies, noDeepLink, withRaw] = await Promise.all([
        prisma.scraperRun.findMany({ where: { merchantId: m.id }, orderBy: { startedAt: "desc" }, take: 2 }),
        prisma.offer.count({ where: { merchantId: m.id } }),
        prisma.offer.count({ where: { merchantId: m.id, flagged: true } }),
        prisma.offer.count({ where: { merchantId: m.id, OR: [{ isStale: true }, { lastSeenAt: { lt: staleCutoff } }] } }),
        prisma.offer.count({ where: { merchantId: m.id, isExpired: true } }),
        prisma.priceAnomaly.count({ where: { resolved: false, offer: { merchantId: m.id } } }),
        prisma.offer.count({ where: { merchantId: m.id, productUrl: null } }),
        prisma.offer.count({ where: { merchantId: m.id, rawPriceText: { not: null } } }),
      ]);
      const last = runs[0];
      const prev = runs[1];
      const nullRate = last && last.offersAttempted > 0 ? last.offersNull / last.offersAttempted : null;
      const delta = last && prev && prev.offersParsed > 0 ? (last.offersParsed - prev.offersParsed) / prev.offersParsed : null;
      return { m, offers, flagged, stale, expired, anomalies, noDeepLink, withRaw, last, nullRate, delta };
    }),
  );

  const totalAnomalies = rows.reduce((a, r) => a + r.anomalies, 0);
  const totalFlagged = rows.reduce((a, r) => a + r.flagged, 0);

  return (
    <div className="container">
      <div className="section" style={{ paddingBottom: 8 }}>
        <h1 style={{ fontSize: 26 }}>Sănătatea scraperelor</h1>
        <p className="muted" style={{ fontSize: 13.5 }}>
          {totalFlagged} oferte semnalate · {totalAnomalies} anomalii de preț nerezolvate ·
          „învechit” = nu l-am mai văzut de {STALE_AFTER_DAYS} zile · „expirat” = promoția s-a încheiat
        </p>
        <p className="muted" style={{ fontSize: 13 }}>
          <Link href="/admin">← Panou admin</Link> · <Link href="/admin/review">Verificare potriviri</Link>
        </p>
      </div>

      <div className="card" style={{ overflowX: "auto" }}>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Magazin</th>
              <th>Ultima rulare</th>
              <th className="num">Oferte</th>
              <th className="num">Δ vs anterior</th>
              <th className="num">Rată null</th>
              <th className="num">Semnalate</th>
              <th className="num">Învechite</th>
              <th className="num">Expirate</th>
              <th className="num">Anomalii</th>
              <th>Trasabilitate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const nullBad = r.nullRate != null && r.nullRate > 0.05;
              const dropBad = r.delta != null && r.delta < -0.4;
              return (
                <tr key={r.m.id}>
                  <td style={{ fontWeight: 600 }}>
                    {r.m.name}
                    <div className="muted" style={{ fontSize: 11.5 }}>{r.m.priceSource}</div>
                  </td>
                  <td className="muted" style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>
                    {r.last ? formatDate(r.last.startedAt) : r.m.lastScrapeAt ? formatDate(r.m.lastScrapeAt) : "—"}
                    {r.last?.aborted && (
                      <div style={{ color: "var(--danger, #b3261e)", fontSize: 11.5 }}>
                        ABANDONAT: {r.last.abortReason?.slice(0, 44)}
                      </div>
                    )}
                  </td>
                  <td className="num">{r.offers}</td>
                  <td className="num" style={dropBad ? { color: "var(--danger, #b3261e)", fontWeight: 700 } : undefined}>
                    {r.delta == null ? "—" : `${r.delta > 0 ? "+" : ""}${(r.delta * 100).toFixed(0)}%`}
                  </td>
                  <td className="num" style={nullBad ? { color: "var(--danger, #b3261e)", fontWeight: 700 } : undefined}>
                    {r.nullRate == null ? "—" : `${(r.nullRate * 100).toFixed(1)}%`}
                  </td>
                  <td className="num">{r.flagged || "—"}</td>
                  <td className="num">{r.stale || "—"}</td>
                  <td className="num">{r.expired || "—"}</td>
                  <td className="num">{r.anomalies || "—"}</td>
                  <td className="muted" style={{ fontSize: 11.5 }}>
                    {r.withRaw > 0 ? `${Math.round((r.withRaw / Math.max(1, r.offers)) * 100)}% cu text sursă` : "fără text sursă"}
                    {r.noDeepLink > 0 && <div>{r.noDeepLink} fără link direct</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="section" style={{ paddingTop: 16 }}>
        <p className="muted" style={{ fontSize: 13, maxWidth: 680 }}>
          <b>Cum se citește:</b> „rată null” este proporția de prețuri pe care parserul nu le-a putut
          citi — peste 5% înseamnă că s-a schimbat pagina, nu că magazinul are mai puține produse.
          „Δ vs anterior” sub −40% declanșează automat refuzul rulării, ca o redesignare de site să nu
          șteargă date bune. „Fără link direct” este normal pentru surse de tip catalog tipărit.
        </p>
      </div>
    </div>
  );
}
