import Link from "next/link";
import { Wallet } from "@/components/Wallet";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cardurile mele de fidelitate" };

export default function CarduriPage() {
  return (
    <div className="container">
      <nav className="breadcrumb" aria-label="breadcrumb">
        <Link href="/">Acasă</Link>
        <span className="sep">/</span>
        <span>Carduri</span>
      </nav>
      <div className="section-head" style={{ marginTop: 8 }}>
        <h1 style={{ fontSize: 26 }}>💳 Cardurile mele de fidelitate</h1>
      </div>
      <p className="muted" style={{ marginTop: -4 }}>
        Ține toate cardurile de fidelitate într-un loc și arată-le la casă.
      </p>
      <Wallet />
      <div style={{ height: 32 }} />
    </div>
  );
}
