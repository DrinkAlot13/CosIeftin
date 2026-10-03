// Public shrinkflation page. Shows REVIEWED detections only — an unreviewed candidate is a
// suspicion, not a finding, and this page makes a claim about a manufacturer's packaging.
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { trustFeaturesEnabled } from "@/lib/flags";
import { formatRON } from "@/lib/format";

// ── force-dynamic BECAUSE THE FLAG IS READ AT RUN TIME.
//
// This page's existence depends on FEATURE_TRUST, and `revalidate` made that decision at BUILD
// time: the build ran without the variable, `notFound()` fired, and the 404 was baked into the
// output. Setting FEATURE_TRUST=true on a running server then changed nothing — verified by
// starting one and fetching this path, which returned 404 with the flag on.
//
// That breaks the flag in the direction nobody checks. `lib/flags.ts` is careful that an
// ambiguous value never turns a feature ON; it says nothing about a deliberate ON silently
// doing nothing, and "publish this" requiring a rebuild is not a publishing workflow.
//
// Caching costs nothing here: both trust pages are small, rarely visited, and gated off.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Ambalaje micșorate — CosIeftin",
  description:
    "Produse la care ambalajul s-a micșorat, iar prețul pe kilogram sau pe litru a crescut. Verificat manual, cu datele la vedere.",
};

const fmtSize = (v: number, unit: string) => {
  if (unit === "BUC") return `${v} buc`;
  if (unit === "G") return v >= 1000 ? `${(v / 1000).toString().replace(".", ",")} kg` : `${v} g`;
  return v >= 1000 ? `${(v / 1000).toString().replace(".", ",")} l` : `${v} ml`;
};
const perUnitLabel = (unit: string) => (unit === "BUC" ? "bucată" : unit === "G" ? "kg" : "litru");

export default async function ShrinkflationPage() {
  // This page states that a named manufacturer shrank a pack while raising its price per kilo.
  // That is defensible with good evidence and indefensible without, and the difference is not
  // visible from inside the code that produces the detections. So it does not exist publicly
  // until somebody sets FEATURE_TRUST — 404, not an empty page, because an empty page invites
  // the assumption that we simply found nothing.
  if (!trustFeaturesEnabled()) notFound();

  const changes = await prisma.productPackChange.findMany({
    where: { reviewed: true, dismissed: false },
    include: { product: { select: { name: true, slug: true, brand: true } } },
    orderBy: { detectedAt: "desc" },
    take: 100,
  });

  return (
    <div className="container">
      <div className="section" style={{ paddingBottom: 6 }}>
        <h1 style={{ fontSize: 28 }}>Ambalaje micșorate</h1>
        <p className="muted" style={{ maxWidth: 640 }}>
          Uneori prețul de pe raft rămâne la fel, dar ambalajul se micșorează — așa că plătești
          mai mult pe kilogram fără să pară o scumpire. Urmărim mărimea ambalajului în timp și
          listăm aici cazurile pe care le-am verificat.
        </p>
      </div>

      {changes.length === 0 ? (
        <div className="pill-note">
          Nu avem încă niciun caz confirmat. Detectările noi sunt verificate manual înainte de
          publicare — preferăm să ratăm un caz decât să acuzăm pe nedrept.
        </div>
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Produs</th>
                <th>Ambalaj</th>
                <th>Preț</th>
                <th>Preț pe unitate</th>
                <th>Din</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>
                    <Link href={`/p/${c.product.slug}`}>{c.product.name}</Link>
                    {c.product.brand && <div className="muted" style={{ fontSize: 12 }}>{c.product.brand}</div>}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {fmtSize(c.oldPackSize, c.unit)} → <b>{fmtSize(c.newPackSize, c.unit)}</b>
                    <div className="muted" style={{ fontSize: 12 }}>−{(c.packShrinkBp / 100).toFixed(1)}%</div>
                  </td>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>
                    {formatRON(c.oldPriceBani / 100)} → {formatRON(c.newPriceBani / 100)}
                  </td>
                  <td style={{ whiteSpace: "nowrap", fontWeight: 700 }}>
                    {formatRON(c.newPricePerUnitBani / 100)}/{perUnitLabel(c.unit)}
                    <div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
                      +{(c.unitPriceRiseBp / 100).toFixed(1)}% față de {formatRON(c.oldPricePerUnitBani / 100)}
                    </div>
                  </td>
                  <td className="muted" style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>
                    {c.firstSeenSmallerAt.toLocaleDateString("ro-RO")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="section" style={{ paddingTop: 16 }}>
        <p className="muted" style={{ fontSize: 13, maxWidth: 660 }}>
          <b>Cum verificăm:</b> înregistrăm un caz doar dacă ambalajul s-a micșorat cu cel puțin
          3%, prețul pe unitate a crescut cu cel puțin 2%, iar noul format a apărut în cel puțin
          două observații consecutive. Dacă unitatea de măsură se schimbă (de exemplu din grame în
          mililitri), nu tragem nicio concluzie — acela e mai probabil un citit greșit al nostru.
          Fiecare caz este verificat de un om înainte de publicare.
        </p>
      </div>
    </div>
  );
}
