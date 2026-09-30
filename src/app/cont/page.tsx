import Link from "next/link";
import { redirect } from "next/navigation";
import { logout } from "@/app/actions";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Contul meu" };

export default async function ContPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/cont");

  return (
    <div className="container">
      <div className="section" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 26 }}>Contul meu</h1>
          <p className="muted" style={{ margin: 0 }}>{user.username}</p>
        </div>
        <form action={logout}><button className="btn btn-outline" type="submit">Deconectare</button></form>
      </div>
      <section className="section">
        <div className="pill-note">
          Lista ta de cumpărături se salvează pe acest dispozitiv. Deschide{" "}
          <Link href="/lista" style={{ color: "var(--primary)" }}>🛒 Lista mea</Link> ca să compari coșul.
        </div>
      </section>
      <div style={{ height: 32 }} />
    </div>
  );
}
