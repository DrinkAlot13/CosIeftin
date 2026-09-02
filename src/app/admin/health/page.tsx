// Scraper health. The question this page answers is the one that was previously
// unanswerable the morning after: did the run find fewer products, or could it not READ
// the products it found? Those look identical in an offer count and are completely
// different problems.
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { computeLiveness, formatSilence, BROKEN_RUN_STREAK, MAX_SILENCE_HOURS } from "@/lib/liveness";
import { sectionKind, SECTION_LABELS } from "@/lib/section-type";

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
      select: { aborted: true, offersWritten: true, abortReason: true },
    }),
  });
  // TWO WAYS TO BE BROKEN, AND THE SECOND IS KNOWN SOONER.
  //
  // `dead` is 48 hours of silence — the backstop, and by the time it fires the prices have
  // been aging for two days. A scraper that has recorded consecutive runs producing nothing is
  // provably broken NOW, and waiting out the clock to say so is choosing to find out late.
  // Penny read 0 products on 2026-09-02 and would have sat green until the following night.
  const deadMerchants = liveness.filter((l) => l.dead || l.deadRunStreak >= BROKEN_RUN_STREAK);

  // COMPARISON vs PRICE sections. A blended comparability figure measures catalog
  // composition rather than matching quality: DCNeu grew by 6,895 single-merchant products
  // when its scraper stopped truncating, and the blended number FELL while the catalog got
  // strictly better. The split is the only version that means anything.
  const sectionRows = await prisma.product.groupBy({ by: ["section"], _count: { _all: true } });
  const liveOfferWhere = { isStale: false, flagged: false, availability: "in stock" } as const;
  const kindStats = await Promise.all(
    sectionRows.map(async (r) => ({
      section: r.section,
      kind: sectionKind(r.section),
      products: r._count._all,
      priced: await prisma.product.count({
        where: { section: r.section, offers: { some: liveOfferWhere } },
      }),
      laddered: await prisma.offer.count({
        where: { ...liveOfferWhere, tiers: { some: {} }, product: { section: r.section } },
      }),
    })),
  );

  const totalAnomalies = rows.reduce((a, r) => a + r.anomalies, 0);
  const totalFlagged = rows.reduce((a, r) => a + r.flagged, 0);

  return (
    <div className="container">
      {/*
        THE ONE ALERT THAT MUST BE IMPOSSIBLE TO MISS.

        The soak reports weekly and deliberately does not mail anything nightly — with one
        exception, and this is it. A merchant with no successful write in 48 hours is the
        Metro/Mega failure: the data is still correct, still passes every correctness check,
        and is being shown to shoppers as today's price by a shop that stopped answering.
        Nothing else on this page can tell that state apart from a healthy one.

        So it is a full-width banner ABOVE the page title, not a coloured cell inside a table
        forty rows down. It renders only when something is actually wrong — a banner that is
        always present is wallpaper within a week, and the next real one goes unread.
      */}
      {deadMerchants.length > 0 && (
        <div
          role="alert"
          style={{
            margin: "12px 0 4px",
            padding: "14px 16px",
            borderRadius: 8,
            background: "#c0392b",
            color: "#fff",
            boxShadow: "0 2px 10px rgba(192,57,43,0.35)",
          }}
        >
          <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: 0.2 }}>
            SURSĂ MOARTĂ — {deadMerchants.length} magazin(e) nu mai scriu date
          </div>
          <div style={{ fontSize: 14, marginTop: 6, lineHeight: 1.5 }}>
            {deadMerchants
              .map((d) => {
                const why = d.dead
                  ? `fără scriere de ${formatSilence(d.hoursSinceWrite)}`
                  : `${d.deadRunStreak} rulări consecutive fără rezultat${d.lastAbortReason ? ` — ${d.lastAbortReason}` : ""}`;
                return `${d.name} (${why}, ${d.liveOffers} oferte încă afișate)`;
              })
              .join(" · ")}
          </div>
          <div style={{ fontSize: 13, marginTop: 8, opacity: 0.92 }}>
            Prețurile lor sunt corecte și vechi în același timp: verificările de corectitudine
            trec, pentru că datele nu s-au stricat — magazinul a încetat să răspundă.
          </div>
        </div>
      )}
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
                {/*
                  Counted the same way as the banner, and worded to match. Saying "de peste 48 h"
                  here while the banner reports a scraper that broke 28 h ago is a dashboard
                  contradicting itself, and the reader is left to guess which number is real.
                */}
                {deadMerchants.length} magazin(e) nu mai scriu date — fără scriere de peste{" "}
                {MAX_SILENCE_HOURS} h, sau {BROKEN_RUN_STREAK}+ rulări consecutive fără rezultat.
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

      {/*
        Sections come AFTER liveness, not before. This table used to sit above it, which put a
        composition metric ahead of the only block on the page that can tell a live source from
        a dead one — the exact ordering mistake the liveness comment above warns against.
      */}
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="section-head"><h2 style={{ margin: 0 }}>Secțiuni</h2></div>
        <div className="card" style={{ overflowX: "auto" }}>
          <p className="muted" style={{ fontSize: 13, margin: "0 0 10px" }}>
            Secțiunile <b>de comparație</b> au mai multe magazine, deci comparabilitatea are
            sens acolo. Secțiunile <b>de preț</b> au un singur magazin prin construcție —
            pentru ele contează acoperirea, nu comparabilitatea.
          </p>
          <table className="admin-table">
            <thead>
              <tr><th>Secțiune</th><th>Tip</th><th>Produse</th><th>Cu preț azi</th><th>Cu preț la cantitate</th></tr>
            </thead>
            <tbody>
              {kindStats.sort((a, b) => b.products - a.products).map((k) => (
                <tr key={k.section}>
                  <td style={{ fontWeight: 600 }}>{SECTION_LABELS[k.section] ?? k.section}</td>
                  <td className="muted">{k.kind === "comparison" ? "comparație" : "preț"}</td>
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>{k.products}</td>
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>
                    {k.priced} ({k.products ? Math.round((k.priced / k.products) * 100) : 0}%)
                  </td>
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>
                    {k.kind === "price" ? k.laddered : "—"}
                  </td>
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
