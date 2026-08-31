"use client";
// Route-level error boundary.
//
// Before this, any client-side exception anywhere in the tree produced Next's bare
// "Application error: a client-side exception has occurred" — a blank page with no way back
// and nothing a visitor could act on. That is what a stale-build ChunkLoadError looked like to
// a user, and it is what any future render bug will look like without this.
//
// It logs the real error (so it is not silently swallowed) and offers a retry, because the two
// commonest causes — a stale chunk after a deploy, and a transient data read — both clear on
// one.
import { useEffect } from "react";
import Link from "next/link";

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[route] render failed:", error);
  }, [error]);

  return (
    <div className="container legal">
      <h1>Ceva n-a mers bine</h1>
      <p className="lead">
        Pagina nu s-a putut încărca. De cele mai multe ori e temporar — încearcă din nou.
      </p>
      <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
        <button className="btn btn-primary" onClick={reset}>Încearcă din nou</button>
        <Link className="btn btn-outline" href="/">Înapoi la pagina principală</Link>
      </div>
      {error.digest && <p className="muted" style={{ marginTop: 22, fontSize: 12.5 }}>Cod eroare: {error.digest}</p>}
    </div>
  );
}
