"use client";
// "Propune un produs echivalent" — lets a signed-in shopper claim two products are the same
// purchase, queued for human review (see EquivalenceSuggestion in schema.prisma for why this is
// never auto-applied). Shown on every product page, not only ones with no alternatives: the
// shopper who actually buys both is the evidence a catalog scan cannot produce on its own.
import { useEffect, useState } from "react";

type Suggestion = { slug: string; name: string; brand: string | null; lowest: number };

export function SuggestEquivalent({ productSlug }: { productSlug: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sug, setSug] = useState<Suggestion[]>([]);
  const [picked, setPicked] = useState<Suggestion | null>(null);
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "duplicate" | "error">("idle");
  // Same endpoint FavoriteHeart already uses to learn sign-in state — no new API surface for it.
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    if (!open || signedIn !== null) return;
    fetch("/api/favorites")
      .then((r) => r.json())
      .then((j: { signedIn?: boolean }) => setSignedIn(Boolean(j.signedIn)))
      .catch(() => setSignedIn(false));
  }, [open, signedIn]);

  useEffect(() => {
    if (!open || picked || q.trim().length < 2) { setSug([]); return; }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/suggest?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((d: Suggestion[]) => setSug(d.filter((s) => s.slug !== productSlug)))
        .catch(() => {});
    }, 150);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q, open, picked, productSlug]);

  async function submit() {
    if (!picked) return;
    setStatus("sending");
    try {
      const r = await fetch("/api/equivalence-suggestions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productSlug, suggestedSlug: picked.slug }),
      });
      const j = await r.json();
      if (!r.ok) { setStatus("error"); return; }
      setStatus(j.alreadyExists ? "duplicate" : "sent");
    } catch {
      setStatus("error");
    }
  }

  if (!open) {
    return (
      <div style={{ marginTop: 10 }}>
        <button type="button" className="linklike" style={{ fontSize: 13 }} onClick={() => setOpen(true)}>
          🔁 Propune un produs echivalent
        </button>
      </div>
    );
  }

  if (signedIn === null) return null;

  if (!signedIn) {
    return (
      <div className="pill-note" style={{ marginTop: 10, fontSize: 13 }}>
        Trebuie să fii autentificat ca să propui un echivalent.
      </div>
    );
  }

  if (status === "sent" || status === "duplicate") {
    return (
      <div className="pill-note" style={{ marginTop: 10, fontSize: 13 }}>
        {status === "sent"
          ? "Mulțumim! Propunerea ta a fost trimisă spre verificare."
          : "Deja a fost propusă — e în așteptare sau deja verificată."}
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: 10, padding: 12, maxWidth: 420 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Ce produs e echivalent cu acesta?</div>
      {picked ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <span>
            {picked.brand ? <b>{picked.brand} </b> : null}{picked.name}
          </span>
          <button type="button" className="linklike" onClick={() => setPicked(null)}>schimbă</button>
        </div>
      ) : (
        <>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Caută produsul echivalent…"
            aria-label="Caută produsul echivalent"
            autoComplete="off"
            style={{ width: "100%" }}
          />
          {sug.length > 0 && (
            <ul className="suggest" style={{ marginTop: 4 }}>
              {sug.map((s) => (
                <li key={s.slug}>
                  <button type="button" onClick={() => { setPicked(s); setSug([]); setQ(""); }}>
                    <span className="s-name">{s.brand ? <span className="s-brand">{s.brand} </span> : null}{s.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button type="button" className="btn btn-outline btn-sm" disabled={!picked || status === "sending"} onClick={submit}>
          {status === "sending" ? "Se trimite…" : "Trimite propunerea"}
        </button>
        <button type="button" className="linklike" onClick={() => { setOpen(false); setPicked(null); setStatus("idle"); }}>
          Anulează
        </button>
      </div>
      {status === "error" && (
        <div className="muted" style={{ fontSize: 12, marginTop: 6, color: "var(--danger, #b3261e)" }}>
          Ceva n-a mers. Încearcă din nou.
        </div>
      )}
    </div>
  );
}
