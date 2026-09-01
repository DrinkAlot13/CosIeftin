// Scraper health. The question this page answers is the one that was previously
// unanswerable the morning after: did the run find fewer products, or could it not READ
// the products it found? Those look identical in an offer count and are completely
// different problems.
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { computeLiveness, formatSilence, MAX_SILENCE_HOURS } from "@/lib/liveness";

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
    select: { id: true, name: true, slug: true, priceChannel: true, lastScrapeAt: true, lastOfferCount: true },
    orderBy: { name: "asc" },
  });

  const rows = await Promise.all(
    merchants.map(async (m) => {
      const [runs, offers, flagged, stale, expired, anomalies, noDeepLink, withRaw] = await Promise.all([
        prisma.scraperRun.findMany({ where: { merchantId: m.id }, orderBy: { startedAt: "desc" }, take: 2 }),
        prisma.offer.count({ where: { merchantId: m.id } }),
        prisma.offer.count({ where: { merchantId: m.id, flagged: true } }),
        prisma.offer.count({ where: { merchantId: m.id, OR: [{ isStale: true }, { lastObservedAt: { lt: staleCutoff } }] } }),
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

  // LIVENESS FIRST, above everything else on this page.
  //
  // Every other number here describes the DATA. Metro and Mega Image were dead for three days
  // while every one of those numbers looked healthy, because the drop guard preserved the data
  // and had no opinion about whether the source still answered. This block is the only thing
  // on the page that can tell those two states apart, so it goes at the top.
  const liveness = await computeLiveness({
    merchants: async () => merchants.map((m) => ({ id: m.id, slug: m.slug, name: m.name, lastScrapeAt: m.lastScrapeAt })),
    newestObservedAt: async (merchantId) => {
      const r = await prisma.offer.findFirst({
        where: { merchantId, lastObservedAt: { not: null } },
        orderBy: { lastObservedAt: "desc" },
        select: { lastObservedAt: true },
      });
      return r?.lastObservedAt ?? null;
    },
    liveOfferCount: (merchantId) => prisma.offer.count({ where: { merchantId, isStale: false, availability: "in stock" } }),
    recentRuns: (merchantId, take) => prisma.scraperRun.findMany({
      where: { merchantId }, orderBy: { startedAt: "desc" }, take,
      select: { aborted: true, offersParsed: true, abortReason: true },
    }),
  });
  const deadMerchants = liveness.filter((l) => l.dead);

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

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="section-head">
          <h2 style={{ margin: 0 }}>Ultima scriere reușită</h2>
        </div>
        <div
          className="card"
          style={{
            overflowX: "auto",
            borderLeft: `4px solid ${deadMerchants.length > 0 ? "#c0392b" : "var(--border)"}`,
          }}
        >
          <p className="muted" style={{ fontSize: 13, margin: "0 0 10px" }}>
            {deadMerchants.length > 0 ? (
              <strong style={{ color: "#c0392b" }}>
                {deadMerchants.length} magazin(e) nu au mai scris nimic de peste {MAX_SILENCE_HOURS} h.
                Ofertele lor sunt încă afișate.
              </strong>
            ) : (
              <>Toate magazinele au scris în ultimele {MAX_SILENCE_HOURS} h.</>
            )}{" "}
            O rulare care s-a oprit singură nu este o scriere reușită: dovada e un rând de
            ofertă, nu o rulare înregistrată.
          </p>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Magazin</th>
                <th>De la ultima scriere</th>
                <th>Oferte live</th>
                <th>Rulări fără rezultat</th>
                <th>Motiv</th>
              </tr>
            </thead>
            <tbody>
              {liveness.map((l) => (
                <tr key={l.slug} style={l.dead ? { background: "rgba(192,57,43,0.07)" } : undefined}>
                  <td style={{ fontWeight: 600 }}>
                    {l.name}
                    {l.claimsWithoutWrites && (
                      <span className="muted" style={{ display: "block", fontSize: 11 }}>
                        a rulat, dar nu a scris nimic
                      </span>
                    )}
                  </td>
                  <td style={{ fontVariantNumeric: "tabular-nums", color: l.dead ? "#c0392b" : undefined, fontWeight: l.dead ? 700 : 400 }}>
                    {formatSilence(l.hoursSinceWrite)}
                  </td>
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>{l.liveOffers}</td>
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>{l.deadRunStreak || "—"}</td>
                  <td className="muted" style={{ fontSize: 12 }}>{l.lastAbortReason ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

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
                    <div className="muted" style={{ fontSize: 11.5 }}>{r.m.priceChannel}</div>
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
