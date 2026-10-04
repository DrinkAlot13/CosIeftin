// Web UI for the equivalence-suggestion review queue — this existed as CLI-only
// (review-equivalence-suggestions.ts). "A queue nobody can find is not a queue" is already this
// admin section's own stated principle (see admin/page.tsx), and a queue only reachable by
// running a terminal command on the right machine is exactly that.
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decideSuggestion } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sugestii de echivalență", robots: { index: false } };

export default async function EquivalenceSuggestionsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin/equivalence-suggestions");
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

  const rows = await prisma.equivalenceSuggestion.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    include: {
      productA: { select: { name: true, brand: true, slug: true, unit: true, unitSize: true } },
      productB: { select: { name: true, brand: true, slug: true, unit: true, unitSize: true } },
      user: { select: { username: true } },
    },
  });

  return (
    <div className="container">
      <nav className="breadcrumb" aria-label="breadcrumb">
        <Link href="/admin">Admin</Link>
        <span className="sep">/</span>
        <span>Sugestii de echivalență</span>
      </nav>
      <div className="section-head" style={{ marginTop: 8 }}>
        <h1 style={{ fontSize: 24 }}>Sugestii de echivalență — {rows.length} în așteptare</h1>
      </div>
      <p className="muted" style={{ maxWidth: 680, marginTop: -6 }}>
        Confirmarea NU creează o clasă de echivalență — doar înregistrează decizia. O clasă reală
        tot trebuie scrisă în cod (src/data/*.ts); npm run review:equivalence-suggestions --
        --confirm=&lt;id&gt; scoate un draft pack() după ce confirmi aici.
      </p>
      {rows.length === 0 ? (
        <div className="empty">Nimic în așteptare.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
          {rows.map((r) => (
            <div key={r.id} className="card" style={{ padding: 14 }}>
              <div className="muted" style={{ fontSize: 12 }}>
                propus de {r.user.username}{r.note && <> — &quot;{r.note}&quot;</>}
                {r.corroborations > 1 && (
                  <span style={{ marginLeft: 8, color: "var(--primary)", fontWeight: 600 }}>
                    · {r.corroborations} cumpărători au spus la fel
                  </span>
                )}
              </div>
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap", margin: "8px 0" }}>
                <div>
                  <Link href={`/p/${r.productA.slug}`} style={{ fontWeight: 600 }}>{r.productA.name}</Link>
                  <div className="muted" style={{ fontSize: 12 }}>{r.productA.brand ?? "—"} · {r.productA.unitSize} {r.productA.unit}</div>
                </div>
                <div style={{ alignSelf: "center" }}>=</div>
                <div>
                  <Link href={`/p/${r.productB.slug}`} style={{ fontWeight: 600 }}>{r.productB.name}</Link>
                  <div className="muted" style={{ fontSize: 12 }}>{r.productB.brand ?? "—"} · {r.productB.unitSize} {r.productB.unit}</div>
                </div>
              </div>
              {r.productA.unit !== r.productB.unit && (
                <div style={{ color: "var(--danger, #b3261e)", fontSize: 13, marginBottom: 8 }}>
                  ⚠ unități diferite ({r.productA.unit} vs {r.productB.unit}) — probabil nu sunt comparabile
                </div>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <form action={async () => { "use server"; await decideSuggestion(r.id, "CONFIRMED"); }}>
                  <button type="submit" className="btn btn-accent btn-sm">Confirmă</button>
                </form>
                <form action={async () => { "use server"; await decideSuggestion(r.id, "REJECTED"); }}>
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
