// Web UI for the "report a problem" queue (review-product-reports.ts, CLI-only until now).
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decideReport } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rapoarte produse", robots: { index: false } };

const bani = (n: number | null | undefined) => (n == null ? "—" : (n / 100).toFixed(2));
const KIND_LABEL: Record<string, string> = { wrong_price: "PREȚ GREȘIT", wrong_product: "PRODUS GREȘIT", other: "ALTCEVA" };

export default async function ProductReportsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin/product-reports");
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

  const rows = await prisma.productReport.findMany({
    where: { status: "OPEN" },
    orderBy: { createdAt: "asc" },
    include: {
      product: {
        select: {
          name: true, brand: true, slug: true,
          offers: { where: { isStale: false, flagged: false }, select: { priceBani: true, merchant: { select: { slug: true, name: true } } } },
        },
      },
      user: { select: { username: true } },
    },
  });

  return (
    <div className="container">
      <nav className="breadcrumb" aria-label="breadcrumb">
        <Link href="/admin">Admin</Link>
        <span className="sep">/</span>
        <span>Rapoarte produse</span>
      </nav>
      <div className="section-head" style={{ marginTop: 8 }}>
        <h1 style={{ fontSize: 24 }}>Rapoarte — {rows.length} deschise</h1>
      </div>
      {rows.length === 0 ? (
        <div className="empty">Nimic deschis.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
          {rows.map((r) => (
            <div key={r.id} className="card" style={{ padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <span className="badge">{KIND_LABEL[r.kind] ?? r.kind}</span>
                <span className="muted" style={{ fontSize: 12 }}>{r.user?.username ?? "anonim"}</span>
              </div>
              <Link href={`/p/${r.product.slug}`} style={{ fontWeight: 600, display: "block", margin: "6px 0 2px" }}>
                {r.product.name}{r.product.brand ? ` (${r.product.brand})` : ""}
              </Link>
              <div className="muted" style={{ fontSize: 12.5 }}>
                {r.product.offers.length === 0
                  ? "fără oferte active"
                  : r.product.offers.map((o) => `${o.merchant.name} ${bani(o.priceBani)}`).join(" · ")}
              </div>
              {r.note && <div style={{ fontSize: 13, marginTop: 6 }}>&quot;{r.note}&quot;</div>}
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <form action={async () => { "use server"; await decideReport(r.id, "RESOLVED"); }}>
                  <button type="submit" className="btn btn-accent btn-sm">Rezolvat</button>
                </form>
                <form action={async () => { "use server"; await decideReport(r.id, "DISMISSED"); }}>
                  <button type="submit" className="btn btn-outline btn-sm">Respinge</button>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{ height: 32 }} />
    </div>
  );
}
