"use client";
// Confirm / reject a flagged product↔offer match. The decision is persisted as a
// MatchOverride so a future rebuild honours it without a human repeating the work.
import { useState } from "react";

export function ReviewActions({ offerId }: { offerId: number }) {
  const [state, setState] = useState<"idle" | "busy" | "confirmed" | "rejected" | "error">("idle");

  async function act(action: "confirm" | "reject") {
    setState("busy");
    try {
      const res = await fetch("/api/admin/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offerId, action }),
      });
      setState(res.ok ? (action === "confirm" ? "confirmed" : "rejected") : "error");
    } catch {
      setState("error");
    }
  }

  if (state === "confirmed") return <span className="muted" style={{ color: "var(--ok, #1f6b4a)" }}>✅ confirmat</span>;
  if (state === "rejected") return <span className="muted" style={{ color: "var(--danger, #b3261e)" }}>🗑 respins</span>;
  if (state === "error") return <span className="muted">eroare — reîncearcă</span>;

  return (
    <div style={{ display: "flex", gap: 6, whiteSpace: "nowrap" }}>
      <button className="btn" disabled={state === "busy"} onClick={() => act("confirm")} title="Potrivirea e corectă — ține prețul și memorează decizia">
        ✅ Corect
      </button>
      <button className="btn" disabled={state === "busy"} onClick={() => act("reject")} title="Nu e același produs — șterge oferta și nu o mai potrivi">
        ✗ Greșit
      </button>
    </div>
  );
}
