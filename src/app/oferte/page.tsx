import Link from "next/link";
import { ProductCard } from "@/components/ProductCard";
import { formatRON } from "@/lib/format";
import { getDeals } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Oferte — cele mai mari economii" };

export default async function OfertePage() {
  const deals = await getDeals(60);
  return (
    <div className="container">
      <nav className="breadcrumb" aria-label="breadcrumb">
        <Link href="/">Acasă</Link>
        <span className="sep">/</span>
        <span>Oferte</span>
      </nav>
      <div className="section-head" style={{ marginTop: 8 }}>
        <h1 style={{ fontSize: 26 }}>🔥 Oferte — unde economisești cel mai mult</h1>
      </div>
      <p className="muted" style={{ marginTop: -4 }}>
        Produsele cu cea mai mare diferență de preț între magazine (și scăderi de preț pe măsură ce se acumulează istoricul).
      </p>
      {deals.length === 0 ? (
        <div className="empty">Nicio ofertă notabilă acum. Revino după următoarea actualizare de prețuri.</div>
      ) : (
        <div className="grid-products">
          {deals.map((p) => (
            <div key={p.id} style={{ position: "relative" }}>
              <span className="deal-badge" style={{ position: "absolute", top: 8, left: 8, zIndex: 2, background: "#0a8a3f", color: "#fff", borderRadius: 8, padding: "2px 8px", fontSize: 12, fontWeight: 700 }}>
                −{Math.round(p.score)}%
              </span>
              <ProductCard p={p} />
              <div className="muted" style={{ fontSize: 12, padding: "2px 6px" }}>
                cel mai ieftin la {p.cheapestStore} · economisești până la {formatRON(p.summary.savings)}
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{ height: 32 }} />
    </div>
  );
}
