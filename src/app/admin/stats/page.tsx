// ── SCOPE: REPORT ONLY. This page writes nothing.
//
// Three questions, and they are asked in this order because each one reframes the next:
//
//   1. how deep is the catalog — how many shops price each product;
//   2. what is each merchant contributing, and with what provenance;
//   3. where would matching effort actually pay.
//
// EVERY RATIO HERE CARRIES ITS DENOMINATOR. "62% comparable" means nothing until you know
// whether the denominator was the whole catalog or the part of it a shop prices today, and this
// project has had one number read as the other more than once. So both are printed, side by
// side, labelled, with the canonical one marked.

import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import {
  getGapAnalysis, getMerchantStats, getPriceDepth, WINDOW_NIGHTS,
  type DepthTable, type MerchantStat,
} from "@/lib/stats/site-stats";
import { BUCKETS } from "@/lib/offer-census";

export const dynamic = "force-dynamic";
export const metadata = { title: "Statistici", robots: { index: false } };

const n = (x: number): string => x.toLocaleString("ro-RO");
const pct = (x: number): string => `${x.toFixed(1)}%`;

/** A bar as wide as its share. No chart library: one div and a width. */
function Bar({ share, tone = "primary" }: { share: number; tone?: "primary" | "accent" | "muted" }) {
  return (
    <span className="stat-bar" aria-hidden>
      <span className={`stat-bar__fill stat-bar__fill--${tone}`} style={{ width: `${Math.max(0.6, share)}%` }} />
    </span>
  );
}

function DepthBlock({ t, note }: { t: DepthTable; note?: string }) {
  return (
    <section className="ms-block">
      <h3 style={{ fontSize: 16, marginBottom: 2 }}>{t.label}</h3>
      <p className="muted ms-note">
        <b>{n(t.withLivePrice)}</b> cu preț azi <span className="stat-canonical">canonic</span>
        {" · "}
        {n(t.inScope)} în catalog{t.unpriced > 0 ? ` (${n(t.unpriced)} fără niciun preț acum)` : ""}
        {note ? ` · ${note}` : ""}
      </p>
      <table className="ms-table">
        <thead>
          <tr>
            <th style={{ width: 90 }}>magazine</th>
            <th style={{ width: 90 }}>produse</th>
            <th style={{ width: 70 }}>din cele cu preț</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {t.buckets.map((b) => (
            <tr key={b.merchants}>
              <td>{b.merchants}</td>
              <td className="num">{n(b.products)}</td>
              <td className="num">{pct(b.shareOfPriced)}</td>
              <td><Bar share={b.shareOfPriced} tone={b.merchants === "1" ? "muted" : "primary"} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function MerchantRow({ m }: { m: MerchantStat }) {
  const p = m.provenance;
  const cov = (v: number) => (p.total === 0 ? "—" : pct((v / p.total) * 100));
  return (
    <>
      <tr className={m.active ? undefined : "is-inactive"}>
        <td>
          <b>{m.slug}</b>
          {!m.active && <span className="muted"> (inactiv)</span>}
        </td>
        <td className="num">{n(m.pooled)}</td>
        <td className="num">{n(m.writtenLastRun)}</td>
        <td className="num">{n(m.written)}</td>
        <td className="num">{n(m.refused)}</td>
        <td className="num">{n(m.unreadableAtMatcher)}</td>
        <td className="num">{n(m.live)}</td>
        <td className="num">{n(m.offersTotal - m.live)}</td>
        <td className="num">{n(m.pendingUnresolved)}</td>
        <td className="num">{n(m.rejected)}</td>
        <td>{m.lastSuccessfulWrite ? formatDate(m.lastSuccessfulWrite) : <span className="stat-bad">niciodată</span>}</td>
        <td>
          {m.abortedRuns > 0 ? <span className="stat-bad">{m.abortedRuns}/{m.runs}</span> : `0/${m.runs}`}
          {m.silentZeroRuns > 0 && <span className="stat-bad"> · {m.silentZeroRuns} tăcute</span>}
        </td>
      </tr>
      <tr className="stat-sub">
        <td colSpan={12}>
          <span className="muted">provenance: </span>
          storeName {cov(p.storeName)} · ownUnitSize {cov(p.ownUnitSize)} · rawPriceText {cov(p.rawPriceText)}
          {" · "}rawSourceBlob {cov(p.rawSourceBlob)} · productUrl {cov(p.productUrl)} · imagine {cov(p.image)}
          {m.abortReasons.length > 0 && (
            <div className="stat-bad" style={{ marginTop: 3 }}>abort: {m.abortReasons.join(" | ")}</div>
          )}
        </td>
      </tr>
    </>
  );
}

export default async function AdminStatsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin/stats");
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

  const [depth, merchants, gaps] = await Promise.all([
    getPriceDepth(),
    getMerchantStats(),
    getGapAnalysis(),
  ]);

  const bucketTotals: Record<string, number> = {};
  for (const b of BUCKETS) bucketTotals[b] = merchants.reduce((s, m) => s + (m.byBucket[b] ?? 0), 0);
  const grandTotal = merchants.reduce((s, m) => s + m.offersTotal, 0);

  return (
    <div className="container" style={{ paddingBottom: 60 }}>
      <nav className="breadcrumb" aria-label="breadcrumb" style={{ marginTop: 16 }}>
        <Link href="/admin">Admin</Link>
        <span className="sep">/</span>
        <span>Statistici</span>
      </nav>
      <h1 style={{ fontSize: 26, marginTop: 8 }}>Statistici</h1>
      <p className="muted" style={{ maxWidth: 720, marginTop: -4 }}>
        Doar citire. Fiecare procent de aici are numitorul lângă el: <b>„cu preț azi”</b> este
        numitorul canonic — produsele pe care un cumpărător le poate compara acum — iar
        „în catalog” include și produsele pe care niciun magazin nu le mai listează.
      </p>

      {/* ── 1. DEPTH ─────────────────────────────────────────────────────────── */}
      <h2 style={{ fontSize: 20, marginTop: 30 }}>1 · Câte magazine dau preț pentru același produs</h2>
      <p className="muted ms-note" style={{ maxWidth: 720 }}>
        Un produs cu un singur preț nu este o comparație. Această distribuție este, în esență,
        măsura dacă site-ul își face treaba.
      </p>

      <DepthBlock t={depth.overall} />

      <div className="stat-cols">
        {depth.bySection.map((s) => <DepthBlock key={s.label} t={s} />)}
      </div>

      <DepthBlock
        t={depth.basket}
        note={depth.basketMissing.length > 0
          ? `${depth.basketMissing.length} linii nu au produsul fixat în catalog`
          : "toate cele 40 de linii au produsul fixat în catalog"}
      />
      {depth.basketMissing.length > 0 && (
        <p className="muted ms-note">Lipsesc: {depth.basketMissing.join(", ")}</p>
      )}

      <DepthBlock
        t={depth.recipes}
        note={depth.recipeClassesEmpty.length > 0 ? `${depth.recipeClassesEmpty.length} clase goale` : "toate clasele au produse"}
      />
      {depth.recipeClassesEmpty.length > 0 && (
        <p className="muted ms-note">Clase fără produse: {depth.recipeClassesEmpty.join(", ")}</p>
      )}

      {/* ── 2. MERCHANTS ─────────────────────────────────────────────────────── */}
      <h2 style={{ fontSize: 20, marginTop: 40 }}>2 · Ce aduce fiecare magazin</h2>
      <p className="muted ms-note" style={{ maxWidth: 760 }}>
        Coloanele „pooled / scrise / refuzate / necitite” însumează ultimele {WINDOW_NIGHTS} nopți
        din <code>ScraperRun</code>; restul descriu starea de acum. Un magazin care adună 7.000 de
        produse și scrie 700 este o cu totul altă problemă decât unul care adună 300 — de aceea
        „pooled” și „scrise (aceeași rulare)” vin din <b>aceeași rulare</b> — a suma paisprezece
        rulări peste același catalog și a le împărți una la alta inventează un raport care nu
        există (mega-image citea „91.973 / 4.395 = 4,8%”, când realitatea e ~7.030 și ~741 pe
        rulare). Nici în aceeași rulare nu sunt un raport curat: <b>„scrise” numără rânduri de
        ofertă</b>, inclusiv reactivări, deci poate depăși „pooled” (kaufland: 247 → 280).
        <b>„tăcute”</b> = rulări care n-au scris nimic și n-au fost marcate abandonate.
        <br />
        <b>„necitite” este 0 peste tot, și este un zero real</b> pentru ceea ce măsoară: pool-uri
        ajunse la matcher fără preț utilizabil. Fiecare scraper aruncă prețurile necitibile când
        își construiește pool-ul, deci nimic necitibil nu ajunge până aici. NU este „câte prețuri
        n-am putut citi” — acel număr nu se înregistrează nicăieri.
      </p>
      <div className="stat-scroll">
        <table className="ms-table stat-merchants">
          <thead>
            <tr>
              <th>magazin</th>
              <th className="num">pooled (ultima rulare)</th>
              <th className="num">scrise (aceeași rulare)</th>
              <th className="num">scrise ({WINDOW_NIGHTS}n, sumă)</th>
              <th className="num">refuzate</th>
              <th className="num">necitite</th>
              <th className="num">live acum</th>
              <th className="num">reținute</th>
              <th className="num">în coadă</th>
              <th className="num">respinse (override)</th>
              <th>ultima scriere</th>
              <th>run-uri abandonate</th>
            </tr>
          </thead>
          <tbody>
            {merchants.map((m) => <MerchantRow key={m.slug} m={m} />)}
          </tbody>
        </table>
      </div>

      <h3 style={{ fontSize: 16, marginTop: 26 }}>Unde stau ofertele care nu se văd</h3>
      <p className="muted ms-note">
        Fiecare ofertă este atribuită exact unui motiv, iar motivele însumează totalul
        ({n(grandTotal)}). Aceeași clasificare pe care o folosesc recensământul și nightly-ul.
      </p>
      <table className="ms-table" style={{ maxWidth: 620 }}>
        <tbody>
          {BUCKETS.map((b) => (
            <tr key={b}>
              <td>{b}</td>
              <td className="num">{n(bucketTotals[b] ?? 0)}</td>
              <td className="num">{grandTotal === 0 ? "—" : pct(((bucketTotals[b] ?? 0) / grandTotal) * 100)}</td>
              <td style={{ width: "40%" }}>
                <Bar share={grandTotal === 0 ? 0 : ((bucketTotals[b] ?? 0) / grandTotal) * 100} tone={b === "live" ? "accent" : "muted"} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ── 3. THE GAP ───────────────────────────────────────────────────────── */}
      <h2 style={{ fontSize: 20, marginTop: 40 }}>3 · Unde ar merita efortul de potrivire</h2>
      <p className="muted ms-note" style={{ maxWidth: 760 }}>
        Perechi propuse pe care nimeni nu le-a decis încă, grupate după motivul pentru care
        matcher-ul nu le-a acceptat singur. Un motiv care apare de mii de ori la un singur
        magazin este o regulă de reparat; același motiv răspândit uniform este matcher-ul
        funcționând așa cum a fost proiectat. Deciziile deja luate NU sunt aici — o respingere
        este o hotărâre, nu o lipsă.
      </p>
      {gaps.length === 0 ? (
        <div className="empty">Nicio pereche nedecisă.</div>
      ) : (
        <table className="ms-table" style={{ maxWidth: 760 }}>
          <thead>
            <tr><th>magazin</th><th>motiv</th><th className="num">perechi</th><th className="num">scor median</th></tr>
          </thead>
          <tbody>
            {gaps.slice(0, 40).map((g) => (
              <tr key={`${g.merchant}::${g.reason}`}>
                <td>{g.merchant}</td>
                <td><code>{g.reason}</code></td>
                <td className="num">{n(g.count)}</td>
                <td className="num">{g.medianScore.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {gaps.length > 40 && <p className="muted ms-note">… și încă {gaps.length - 40} combinații.</p>}
    </div>
  );
}
