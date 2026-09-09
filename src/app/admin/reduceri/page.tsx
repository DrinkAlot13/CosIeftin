// The review surface for /reduceri-reale — every candidate, including the ones the public page
// refuses, with the arithmetic that produced each verdict.
//
// It exists because the public page's own gate is invisible from the public page. A row that
// never renders leaves no trace, so "we publish nothing" and "we publish nothing because the
// evidence is bad" look identical from outside. This is where they look different.
//
// It is deliberately READ-ONLY. A per-row approve/dismiss store would be the natural next step
// — `ProductPackChange` has one — but building a decision table for a feature that cannot yet
// publish would be recording judgements about numbers we already know are on the wrong basis.
// The gate comes first; the workflow comes when the gate passes.
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDiscountRows, publishable, basisIsAmbiguous, type DiscountRow } from "@/lib/discount-page";
import { verdictLabel } from "@/lib/discount-verify";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reduceri — verificare", robots: { index: false } };

const lei = (b: number | null | undefined) => (b == null ? "—" : `${(b / 100).toFixed(2).replace(".", ",")}`);

const TONE: Record<string, string> = { good: "#1f6b4a", neutral: "#5a6157", warn: "#8a4f10" };

export default async function AdminReduceriPage({
  searchParams,
}: {
  searchParams?: { all?: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin/reduceri");
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

  const showAll = searchParams?.all === "1";
  const rows = await getDiscountRows({ onlyRetailerBacked: !showAll, limit: showAll ? 300 : 400 });
  const pub = publishable(rows);
  const pubIds = new Set(pub.map((r) => r.offerId));

  const withheld = rows.filter((r) => !pubIds.has(r.offerId));
  const reasonFor = (r: DiscountRow): string => {
    if (r.evidence.advertisedWasIsIncoherent) return `preț „vechi" ${lei(r.evidence.advertisedWasBani)} nu este peste ${lei(r.priceBani)}`;
    if (r.evidence.disagreesWithOurHistory) return `magazinul spune ${lei(r.evidence.omnibus30dBani)}, noi am observat ${lei(r.evidence.ourMin30dBani)}`;
    if (basisIsAmbiguous(r)) return `magazinul afișează două prețuri (raft ${lei(r.shelfBani)} / card ${lei(r.loyaltyBani)}) și nu știm pe care linie stă minimul lui`;
    if (r.evidence.baselineSource !== "RETAILER") return `fără cifra magazinului — baza ar fi istoricul nostru (${r.evidence.coverageDays} zile)`;
    if (r.evidence.verdict !== "REDUCERE_REALA") return `verdict ${r.evidence.verdict}`;
    return "—";
  };

  return (
    <div className="container">
      <div className="section" style={{ paddingBottom: 6 }}>
        <h1 style={{ fontSize: 24 }}>Reduceri — ce s-ar publica și ce nu</h1>
        <p className="muted" style={{ maxWidth: 720, fontSize: 13 }}>
          Pagina publică arată doar rândurile din primul tabel. Al doilea tabel este motivul
          pentru care restul nu apar — un rând care nu se randează nu lasă nicio urmă, așa că
          „nu publicăm nimic" și „nu publicăm nimic pentru că dovada e proastă" arată la fel din
          afară. Aici arată diferit.
        </p>
        <p className="muted" style={{ fontSize: 13 }}>
          <Link href={showAll ? "/admin/reduceri" : "/admin/reduceri?all=1"}>
            {showAll ? "Doar ofertele cu cifra magazinului" : "Arată și ofertele fără cifra magazinului"}
          </Link>
          {" · "}
          <code>npm run audit:discount-truth</code> dă rata de acord care decide dacă se publică.
        </p>
      </div>

      <div className="section">
        <h2 style={{ fontSize: 18 }}>S-ar publica ({pub.length})</h2>
        {pub.length === 0 ? (
          <div className="pill-note">
            Niciun rând nu trece. Asta este starea corectă cât timp <code>audit:discount-truth</code>{" "}
            raportează PUBLISHABLE: NO.
          </div>
        ) : (
          <div className="card" style={{ overflowX: "auto" }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Produs</th><th>Magazin</th><th>Acum</th><th>Linie</th>
                  <th>Minim 30z (magazin)</th><th>Minim (noi)</th><th>Zile urmărite</th><th>Economie</th>
                </tr>
              </thead>
              <tbody>
                {pub.map((r) => (
                  <tr key={r.offerId}>
                    <td><Link href={`/p/${r.productSlug}`}>{r.productName}</Link></td>
                    <td>{r.merchantName}</td>
                    <td style={{ textAlign: "right" }}>{lei(r.priceBani)}</td>
                    <td>{r.priceLine === "LOYALTY" ? "card" : "raft"}</td>
                    <td style={{ textAlign: "right" }}>{lei(r.evidence.omnibus30dBani)}</td>
                    <td style={{ textAlign: "right" }}>{lei(r.evidence.ourMin30dBani)}</td>
                    <td style={{ textAlign: "right" }}>{r.evidence.coverageDays}</td>
                    <td style={{ textAlign: "right", color: TONE.good }}>−{lei(r.evidence.realSavingBani)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="section">
        <h2 style={{ fontSize: 18 }}>Reținute ({withheld.length})</h2>
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Produs</th><th>Magazin</th><th>Raft</th><th>Card</th>
                <th>Minim 30z</th><th>Verdict</th><th>De ce nu se publică</th>
              </tr>
            </thead>
            <tbody>
              {withheld.slice(0, 200).map((r) => {
                const { label, tone } = verdictLabel(r.evidence.verdict, r.evidence.windowDays);
                return (
                  <tr key={r.offerId}>
                    <td><Link href={`/p/${r.productSlug}`}>{r.productName}</Link></td>
                    <td>{r.merchantName}</td>
                    <td style={{ textAlign: "right" }}>{lei(r.shelfBani)}</td>
                    <td style={{ textAlign: "right" }}>{lei(r.loyaltyBani)}</td>
                    <td style={{ textAlign: "right" }}>{lei(r.evidence.omnibus30dBani)}</td>
                    <td style={{ color: TONE[tone] }}>{label}</td>
                    <td className="muted" style={{ fontSize: 12.5 }}>{reasonFor(r)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {withheld.length > 200 && (
          <p className="muted" style={{ fontSize: 12.5 }}>… și încă {withheld.length - 200}.</p>
        )}
      </div>
    </div>
  );
}
