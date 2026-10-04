// The soak report (scripts/soak-report.ts), on a page instead of a terminal — "a nightly-run
// health view instead of reading raw logs". Runs the EXISTING script unchanged and shows its
// output; the diffing logic (state changes, missing days, the three failure shapes it hunts for)
// stays in one place rather than being re-derived here, which is exactly the kind of restatement
// CLAUDE.md's "ONE NAMED CONCEPT" section warns drifts out of sync.
import Link from "next/link";
import { redirect } from "next/navigation";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Raport soak", robots: { index: false } };

const run = promisify(execFile);

export default async function SoakPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin/soak");
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

  let output: string;
  try {
    const { stdout } = await run("npx", ["tsx", "scripts/soak-report.ts"], { cwd: process.cwd(), timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
    output = stdout;
  } catch (e) {
    const err = e as { stdout?: string; message?: string };
    output = err.stdout || `Nu am putut rula raportul: ${err.message ?? String(e)}`;
  }

  return (
    <div className="container">
      <nav className="breadcrumb" aria-label="breadcrumb">
        <Link href="/admin">Admin</Link>
        <span className="sep">/</span>
        <span>Soak</span>
      </nav>
      <div className="section-head" style={{ marginTop: 8 }}>
        <h1 style={{ fontSize: 24 }}>Raport soak — ultimele 14 nopți</h1>
      </div>
      <p className="muted" style={{ marginTop: -6, maxWidth: 680 }}>
        Rulează npm run soak:report direct. Nu recalculează nimic — fiecare fapt de mai jos a
        fost înregistrat de un audit în noaptea în care a rulat.
      </p>
      <pre className="card" style={{ padding: 16, overflowX: "auto", fontSize: 12.5, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
        {output}
      </pre>
    </div>
  );
}
