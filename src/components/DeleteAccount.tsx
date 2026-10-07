"use client";
// Self-serve account deletion (GDPR Article 17). Requires the password again — see
// /api/account/delete's own comment for why a session cookie alone is not enough for an
// irreversible action — plus a native confirm() as a second, cheap guard against a stray click.
import { useState } from "react";

export function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!window.confirm("Ești absolut sigur? Contul și tot ce ai salvat în el vor fi șterse definitiv — nu putem anula asta.")) return;
    setWorking(true);
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        window.location.href = "/";
        return;
      }
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Nu am putut șterge contul.");
    } catch {
      setError("Nu am putut șterge contul. Încearcă din nou.");
    } finally {
      setWorking(false);
    }
  }

  if (!open) {
    return <button type="button" className="btn btn-outline" style={{ color: "var(--danger)", borderColor: "var(--danger)" }} onClick={() => setOpen(true)}>Șterge contul</button>;
  }

  return (
    <form onSubmit={submit} className="auth-form" style={{ maxWidth: 360 }}>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        Confirmă parola ca să ștergi contul definitiv — favorite, liste, buget, tot.
      </p>
      {error && <div className="alert-err">{error}</div>}
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Parola ta" autoComplete="current-password" required />
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" className="btn btn-primary" style={{ background: "var(--danger)" }} disabled={working}>
          {working ? "…" : "Confirmă ștergerea"}
        </button>
        <button type="button" className="btn btn-outline" onClick={() => setOpen(false)}>Renunță</button>
      </div>
    </form>
  );
}
