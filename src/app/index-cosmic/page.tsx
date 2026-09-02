// Indexul CoșMic — what a fixed basket of 40 everyday products costs, and how that moves.
//
// This page had two problems and only one of them was the error the user hit.
//
//   1. NOBODY COULD TELL WHAT IT WAS. It opened on a number with no explanation of what was in
//      the basket, who chose it, or what it was for. A feature the owner of the site cannot
//      describe is a product failure regardless of whether it renders.
//
//   2. THE BASKET WAS NOT FIXED. It was resolved at request time by substring search, so its
//      membership changed with the catalog, and it priced coffee creamer as coffee. Two stored
//      snapshots read 79,71 lei and 101,06 lei three days apart — +26,8%, none of it inflation.
//
// Both are answered the same way: the basket is pinned in `lib/index-basket`, forty named packs,
// and this page explains that in Romanian before it shows a single number.
//
// It also no longer recomputes fifteen sequential catalog searches on every request; it prices
// forty pinned slugs in one query and reads the history in one more.

import { Fragment } from "react";
import Link from "next/link";
import { BasketChart } from "@/components/BasketChart";
import { formatRON } from "@/lib/format";
import { BASKET_GROUPS, BASKET_VERSION, INDEX_BASKET } from "@/lib/index-basket";
import { basketSeries, periodChanges, priceBasketNow } from "@/lib/index-series";

export const revalidate = 3600;

export const metadata = {
  title: "Indexul CoșMic — cât costă un coș fix de 40 de produse",
  description:
    "Un coș fix de 40 de produse de bază, aceleași în fiecare lună, evaluat la cel mai mic preț din magazinele urmărite de noi. Nu este o cifră oficială de inflație.",
};

function pct(n: number): string {
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
}

export default async function IndexPage() {
  const [now, series] = await Promise.all([priceBasketNow(), basketSeries()]);
  const { month, year, spanDays } = periodChanges(series.points);
  const complete = series.points.filter((p) => p.complete);

  // Merchants that could price the WHOLE basket on the most recent day. A merchant that priced
  // 31 of 40 is not "cheaper" — it is missing nine products, and ranking it against a complete
  // basket would be the same error as comparing two months of different composition.
  const lastPoint = series.points[series.points.length - 1];
  const fullMerchants = (lastPoint?.byMerchant ?? []).filter((m) => m.complete);
  const partialMerchants = (lastPoint?.byMerchant ?? []).filter((m) => !m.complete);

  return (
    <div className="container" style={{ maxWidth: 900, paddingBottom: 48 }}>
      <nav className="breadcrumb" aria-label="breadcrumb">
        <Link href="/">Acasă</Link>
        <span className="sep">/</span>
        <span>Indexul CoșMic</span>
      </nav>

      <h1 style={{ fontSize: 28, marginBottom: 4 }}>Indexul CoșMic — cât costă coșul</h1>
      <p className="muted" style={{ maxWidth: 660, lineHeight: 1.6, marginTop: 0 }}>
        Am ales <b>40 de produse de bază</b> — lapte, pâine, ouă, ulei, zahăr, carne, legume,
        detergent — și le urmărim prețul în timp. <b>Lista nu se schimbă de la o lună la alta.</b>{" "}
        Exact aceleași 40 de produse, aceleași ambalaje, în fiecare zi. Așa se vede dacă s-au
        scumpit ele, nu dacă am schimbat noi lista.
      </p>

      {/* ── The headline. Never shown without saying how complete it is. */}
      <div className="index-cards" style={{ marginTop: 18 }}>
        <div className="card result-card best">
          <div className="rc-label">🧺 Coșul azi, la cel mai mic preț</div>
          <div className="rc-total">{formatRON(now.total)}</div>
          <div className="muted">
            {now.priced}/{now.of} produse{now.complete ? "" : " — coș incomplet"} ·{" "}
            {now.computedAt.toLocaleDateString("ro-RO")}
          </div>
        </div>

        <div className="card result-card">
          <div className="rc-label">📅 Față de acum o lună</div>
          {month ? (
            <>
              <div className="rc-total">{pct(month.pct)}</div>
              <div className="muted">{month.from} → {month.to}</div>
            </>
          ) : (
            <>
              <div className="rc-none">încă nu</div>
              <div className="muted">
                avem {spanDays} zile de istoric; comparația lunară cere două momente la cel puțin
                28 de zile distanță, cu aceleași produse evaluate
              </div>
            </>
          )}
        </div>

        <div className="card result-card">
          <div className="rc-label">📆 Față de anul trecut</div>
          {year ? (
            <>
              <div className="rc-total">{pct(year.pct)}</div>
              <div className="muted">{year.from} → {year.to}</div>
            </>
          ) : (
            <>
              <div className="rc-none">încă nu</div>
              <div className="muted">
                măsurăm de pe {series.firstObserved ?? "—"}; cifra anuală apare când avem un an
                de istoric
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Honest about the shape of the data, above the chart rather than in a footnote. */}
      <div className="pill-note" style={{ marginTop: 16 }}>
        Istoricul nostru începe pe <b>{series.firstObserved ?? "—"}</b> și are{" "}
        <b>{series.points.length} zile</b> cu măsurători, dintre care {complete.length} complete.
        Nu completăm zilele lipsă cu estimări: o zi în care n-am avut preț pentru un produs este
        marcată ca incompletă și nu intră în comparații.
      </div>

      <h2 style={{ fontSize: 20, marginTop: 30 }}>Cum a evoluat coșul</h2>
      <BasketChart points={series.points} />

      {/* ── Per merchant, but only for merchants that can actually supply the whole basket. */}
      <h2 style={{ fontSize: 20, marginTop: 30 }}>Cât costă coșul la fiecare magazin</h2>
      <p className="muted" style={{ fontSize: 13.5, marginTop: -6, maxWidth: 660 }}>
        Cifra de sus este cel mai mic preț per produs, luat de oriunde. Aici e cât ar costa
        <b> tot coșul dintr-un singur magazin</b> — dar numai pentru magazinele care au toate cele{" "}
        {INDEX_BASKET.length} produse. Un magazin căruia îi lipsesc produse ar părea mai ieftin
        fără să fie.
      </p>
      <div className="card" style={{ overflowX: "auto", marginTop: 10 }}>
        <table className="admin-table">
          <thead>
            <tr><th>Magazin</th><th>Coșul complet</th><th>Produse găsite</th></tr>
          </thead>
          <tbody>
            {fullMerchants.length === 0 && (
              <tr>
                <td colSpan={3} className="muted">
                  Niciun magazin nu are toate cele {INDEX_BASKET.length} produse din coș.
                </td>
              </tr>
            )}
            {fullMerchants.map((m) => (
              <tr key={m.merchant}>
                <td style={{ fontWeight: 600 }}>{m.merchant}</td>
                <td style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{formatRON(m.total)}</td>
                <td className="muted">{m.priced}/{INDEX_BASKET.length}</td>
              </tr>
            ))}
            {partialMerchants.map((m) => (
              <tr key={m.merchant}>
                <td className="muted">{m.merchant}</td>
                <td className="muted">—</td>
                <td className="muted">{m.priced}/{INDEX_BASKET.length} — coș incomplet</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── The basket itself. The point of a fixed basket is that you can read it. */}
      <h2 style={{ fontSize: 20, marginTop: 32 }}>Ce este în coș</h2>
      <p className="muted" style={{ fontSize: 13.5, marginTop: -6 }}>
        Versiunea {BASKET_VERSION} a coșului. Dacă schimbăm lista, schimbăm și versiunea, iar
        lunile dinainte și de după nu se mai compară între ele.
      </p>
      <div className="card" style={{ overflowX: "auto", marginTop: 10 }}>
        <table className="admin-table">
          <thead>
            <tr><th>Produs</th><th>Cel mai mic preț</th><th>Magazin</th><th>Produsul urmărit</th></tr>
          </thead>
          <tbody>
            {BASKET_GROUPS.map((g) => (
              <Fragment key={g}>
                <tr>
                  <td colSpan={4} style={{ fontWeight: 700, background: "var(--primary-050)", fontSize: 13 }}>{g}</td>
                </tr>
                {now.lines.filter((l) => l.item.group === g).map((l) => (
                  <tr key={l.item.key}>
                    <td style={{ fontWeight: 600 }}>{l.item.label}</td>
                    <td style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
                      {l.price != null ? formatRON(l.price) : <span className="muted">fără preț azi</span>}
                    </td>
                    <td className="muted">{l.merchant ?? "—"}</td>
                    <td className="muted" style={{ fontSize: 13 }}>
                      {l.found ? (
                        <Link href={`/p/${l.item.slug}`}>{l.productName}</Link>
                      ) : (
                        <b>produsul fixat nu mai există în catalog</b>
                      )}
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── What it is not. */}
      <h2 style={{ fontSize: 20, marginTop: 32 }}>Ce măsoară și ce nu măsoară</h2>
      <ul style={{ lineHeight: 1.75, paddingLeft: 20, maxWidth: 700 }}>
        <li>
          <b>Se actualizează zilnic</b>, după ce citim prețurile din magazine. Istoricul se
          construiește din prețurile pe care le-am văzut noi, la data la care le-am văzut.
        </li>
        <li>
          <b>Este coșul nostru, la magazinele noastre.</b> Măsoară ce costă aceste 40 de produse
          la magazinele pe care le urmărim — nimic mai mult.
        </li>
        <li>
          <b>Nu este o cifră oficială de inflație</b> și nu o comparăm cu una. Inflația oficială
          se calculează altfel, pe alt coș, de altcineva.
        </li>
        <li>
          <b>Nu completăm datele lipsă.</b> O zi fără preț pentru un produs rămâne incompletă.
        </li>
        <li>
          Prețurile de livrare pot fi mai mari decât cele de raft, iar promoțiile intră în coș
          atâta timp cât sunt valabile.
        </li>
      </ul>

      <p style={{ marginTop: 22, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link className="btn btn-primary" href="/lista">Fă-ți propriul coș →</Link>
        <Link className="btn btn-outline" href="/metodologie">Cum funcționează CoșMic</Link>
      </p>
    </div>
  );
}
