"use client";
// Replaces a static "raportează un preț greșit" link that went nowhere — it pointed at
// /metodologie, a page about methodology, not a way to actually tell us anything. Two distinct
// kinds on purpose (see api/product-reports/route.ts): a wrong PRICE and a wrong PRODUCT point a
// reviewer at completely different fixes.
import { useState } from "react";

export function ReportProblem({ productSlug }: { productSlug: string }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"wrong_price" | "wrong_product" | "other" | null>(null);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function submit() {
    if (!kind) return;
    setStatus("sending");
    try {
      const r = await fetch("/api/product-reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productSlug, kind, note: note.trim() || undefined }),
      });
      setStatus(r.ok ? "sent" : "error");
    } catch {
      setStatus("error");
    }
  }

  if (!open) {
    return (
      <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
        Prețul nu e corect sau pagina amestecă două produse?{" "}
        <button type="button" className="linklike" onClick={() => setOpen(true)}>spune-ne</button>
      </p>
    );
  }

  if (status === "sent") {
    return <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>Mulțumim, am notat.</p>;
  }

  return (
    <div className="card" style={{ marginTop: 8, padding: 12, maxWidth: 420, fontSize: 13 }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Ce e greșit?</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="radio" name="report-kind" checked={kind === "wrong_price"} onChange={() => setKind("wrong_price")} />
          Prețul afișat nu e cel real
        </label>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="radio" name="report-kind" checked={kind === "wrong_product"} onChange={() => setKind("wrong_product")} />
          Pagina amestecă două produse diferite
        </label>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="radio" name="report-kind" checked={kind === "other"} onChange={() => setKind("other")} />
          Altceva
        </label>
      </div>
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Detalii (opțional)"
        style={{ width: "100%", marginBottom: 8 }}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="btn btn-outline btn-sm" disabled={!kind || status === "sending"} onClick={submit}>
          {status === "sending" ? "Se trimite…" : "Trimite"}
        </button>
        <button type="button" className="linklike" onClick={() => setOpen(false)}>Anulează</button>
      </div>
      {status === "error" && <div className="muted" style={{ fontSize: 12, marginTop: 6, color: "var(--danger, #b3261e)" }}>Ceva n-a mers. Încearcă din nou.</div>}
    </div>
  );
}
