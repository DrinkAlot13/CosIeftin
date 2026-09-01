// Confirm rate, sliced the ways that change a decision.
//
// The queue is not the point — the measurement is. 3,775 candidates are worth an evening only
// if working through them yields matches; and if `mutually-distinct` confirms often, the right
// fix is the matcher, not a queue somebody works forever.
import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { matchStats, verdictFor, TOO_AGGRESSIVE_ABOVE, WORKING_BELOW, type RateRow } from "@/lib/match-stats";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rata de confirmare" };

const pct = (n: number): string => (n * 100).toFixed(1) + "%";

function Table({ title, rows, note }: { title: string; rows: RateRow[]; note?: string }) {
  if (rows.length === 0) return null;
  return (
    <section className="ms-block">
      <h2>{title}</h2>
      {note && <p className="muted ms-note">{note}</p>}
      <table className="ms-table">
        <thead>
          <tr><th>{title}</th><th>confirmate</th><th>respinse</th><th>total</th><th>rată</th><th>citire</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const v = verdictFor(r.rate, r.total);
            return (
              <tr key={r.key}>
                <td>{r.key}</td>
                <td>{r.confirmed}</td>
                <td>{r.rejected}</td>
                <td>{r.total}</td>
                <td><b>{pct(r.rate)}</b></td>
                <td className={`ms-verdict ms-${v.replace(/\s+/g, "-")}`}>{v}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

export default async function MatchStatsPage() {
  const user = await getCurrentUser();
  if (!user?.isAdmin) notFound();

  const s = await matchStats();

  return (
    <div className="container legal" style={{ maxWidth: 900 }}>
      <h1>Rata de confirmare</h1>
      <p className="lead">
        <Link href="/admin/matches">← înapoi la coadă</Link>
      </p>

      {s.overall.total === 0 ? (
        <p className="muted">
          Nicio decizie încă. Verifică ~100 de potriviri în coadă și revino — sub 30 de decizii
          per regulă cifrele nu spun nimic.
        </p>
      ) : (
        <>
          <div className="legal-stats">
            <div><b>{pct(s.overall.rate)}</b><span>rată de confirmare</span></div>
            <div><b>{s.overall.confirmed}</b><span>confirmate</span></div>
            <div><b>{s.overall.rejected}</b><span>respinse</span></div>
            <div><b>{s.overall.total}</b><span>decizii</span></div>
          </div>

          <section className="ms-block">
            <h2>Regula <code>mutually-distinct</code></h2>
            {s.mutuallyDistinct ? (
              <>
                <p>
                  {s.mutuallyDistinct.confirmed} confirmate din {s.mutuallyDistinct.total} —{" "}
                  <b>{pct(s.mutuallyDistinct.rate)}</b>.
                </p>
                <p className={`ms-callout ms-${(s.mutuallyDistinctVerdict ?? "").replace(/\s+/g, "-")}`}>
                  {s.mutuallyDistinctVerdict === "too aggressive" && (
                    <>Peste {pct(TOO_AGGRESSIVE_ABOVE)} — regula respinge potriviri reale. Se
                    repară regula, dar coada rămâne.</>
                  )}
                  {s.mutuallyDistinctVerdict === "working" && (
                    <>Sub {pct(WORKING_BELOW)} — regula își face treaba. Coada e în mare parte
                    respingeri corecte.</>
                  )}
                  {s.mutuallyDistinctVerdict === "not enough signal" && (
                    <>Încă nu e destul semnal ({s.mutuallyDistinct.total} decizii). Pragurile sunt{" "}
                    {pct(TOO_AGGRESSIVE_ABOVE)} și {pct(WORKING_BELOW)}, cu minim 30 de decizii.</>
                  )}
                </p>
              </>
            ) : (
              <p className="muted">Nicio decizie pe această regulă încă.</p>
            )}
          </section>

          <Table title="după regulă" rows={s.byRule}
            note="Regula care a pus potrivirea în coadă. Asta decide dacă se repară matcher-ul sau nu." />
          <Table title="după poziție în coadă" rows={s.byRank}
            note="Dacă primele 100 confirmă mult mai des decât restul, coada merită lucrată în ordine și abandonată devreme." />
          <Table title="după scor" rows={s.byScore} />
          <Table title="după valoare" rows={s.byCreatesComparison} />
          <Table title="după secțiune" rows={s.bySection} />
          <Table title="după magazin" rows={s.byMerchant} />
        </>
      )}
    </div>
  );
}
