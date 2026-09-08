"use client";
// THE LAST-RESORT BOUNDARY — for errors that `src/app/error.tsx` cannot catch.
//
// A route-level `error.tsx` only helps once React has mounted. Two failures happen before that
// and escape it entirely:
//
//   1. An error thrown by the ROOT LAYOUT itself.
//   2. A ChunkLoadError — the browser asking for `/_next/static/chunks/.../page-<hash>.js` and
//      getting a 404. That is what a stale build looks like from the outside, and it is what
//      produced a blank page reading "Application error: a client-side exception has occurred"
//      on /admin. The boundary in error.tsx names that exact cause in its own comment and still
//      could not catch it, because its own chunk was part of what failed to load.
//
// `global-error.tsx` replaces the whole document, so it must render its own <html> and <body>.
//
// It names the likely cause rather than apologising vaguely, because for a chunk error the fix
// really is a hard reload — the visitor is holding a page from a build that no longer exists.
// See `npm run serve`, which stops the server before building so this stops happening at all.

import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[global] unrecoverable:", error);
  }, [error]);

  const isChunk = /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported/i.test(
    `${error.name} ${error.message}`,
  );

  return (
    <html lang="ro">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif", background: "#0d1117", color: "#e6edf3" }}>
        <div style={{ maxWidth: 620, margin: "12vh auto", padding: "0 24px" }}>
          <h1 style={{ fontSize: 26, marginBottom: 10 }}>Pagina nu s-a putut încărca</h1>
          <p style={{ lineHeight: 1.6, color: "#9aa7b2" }}>
            {isChunk
              ? "Site-ul a fost actualizat în timp ce pagina era deschisă, așa că browserul cerea fișiere care nu mai există. O reîncărcare completă rezolvă."
              : "A apărut o eroare neașteptată. De cele mai multe ori e temporară."}
          </p>
          <div style={{ display: "flex", gap: 10, marginTop: 22, flexWrap: "wrap" }}>
            <button
              onClick={() => window.location.reload()}
              style={{ padding: "10px 16px", borderRadius: 8, border: 0, background: "#2f81f7", color: "#fff", cursor: "pointer", fontSize: 15 }}
            >
              Reîncarcă pagina
            </button>
            <button
              onClick={reset}
              style={{ padding: "10px 16px", borderRadius: 8, border: "1px solid #30363d", background: "transparent", color: "#e6edf3", cursor: "pointer", fontSize: 15 }}
            >
              Încearcă din nou
            </button>
          </div>
          {error.digest && (
            <p style={{ marginTop: 26, fontSize: 12.5, color: "#6e7781" }}>Cod eroare: {error.digest}</p>
          )}
        </div>
      </body>
    </html>
  );
}
