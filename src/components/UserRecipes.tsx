"use client";
// Shopper-submitted recipes. Deliberately labelled as the WEAKER, search-resolved kind
// everywhere it appears — see the UserRecipe model's own comment in schema.prisma for why a
// free-text recipe cannot use the same equivalence-class resolution the curated ones on
// /retete do, and what that costs in match quality.
import { useEffect, useState } from "react";
import Link from "next/link";
import { addItem, createCart } from "@/lib/carts";

type Recipe = { id: number; name: string; note: string | null; ingredients: string[]; username: string; createdAt: string };
type ResolvedLine = { label: string; match: { slug: string; name: string; brand: string | null; lowest: number } | null };

function SubmitForm({ onSubmitted }: { onSubmitted: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [ingredientsText, setIngredientsText] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "error">("idle");

  async function submit() {
    const ingredients = ingredientsText.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!name.trim() || ingredients.length === 0) return;
    setStatus("sending");
    try {
      const r = await fetch("/api/user-recipes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), note: note.trim() || undefined, ingredients }),
      });
      if (!r.ok) { setStatus("error"); return; }
      setName(""); setNote(""); setIngredientsText(""); setOpen(false); setStatus("idle");
      onSubmitted();
    } catch {
      setStatus("error");
    }
  }

  if (!open) {
    return <button type="button" className="btn btn-outline" onClick={() => setOpen(true)}>+ Adaugă rețeta ta</button>;
  }

  return (
    <div className="card" style={{ padding: 16, maxWidth: 480, marginBottom: 16 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Rețeta ta</div>
      <input aria-label="Numele rețetei" value={name} onChange={(e) => setName(e.target.value)} placeholder="Numele rețetei" style={{ width: "100%", marginBottom: 8 }} />
      <input aria-label="O propoziție despre rețetă" value={note} onChange={(e) => setNote(e.target.value)} placeholder="O propoziție despre ea (opțional)" style={{ width: "100%", marginBottom: 8 }} />
      <label htmlFor="ur-ingredients" className="muted" style={{ fontSize: 12.5, display: "block", marginBottom: 4 }}>
        Un ingredient pe linie — vom căuta cel mai apropiat produs pentru fiecare.
      </label>
      <textarea
        id="ur-ingredients"
        value={ingredientsText}
        onChange={(e) => setIngredientsText(e.target.value)}
        placeholder={"ouă\nfăină\nlapte"}
        rows={5}
        style={{ width: "100%", marginBottom: 8, font: "inherit" }}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="btn btn-accent" disabled={status === "sending"} onClick={submit}>
          {status === "sending" ? "Se trimite…" : "Trimite"}
        </button>
        <button type="button" className="linklike" onClick={() => setOpen(false)}>Anulează</button>
      </div>
      {status === "error" && <div className="muted" style={{ fontSize: 12, marginTop: 6, color: "var(--danger, #b3261e)" }}>Ceva n-a mers.</div>}
    </div>
  );
}

function RecipeCard({ r }: { r: Recipe }) {
  const [state, setState] = useState<"idle" | "loading" | "preview" | "added">("idle");
  const [lines, setLines] = useState<ResolvedLine[]>([]);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());

  async function resolve() {
    setState("loading");
    const results = await Promise.all(
      r.ingredients.map(async (label): Promise<ResolvedLine> => {
        try {
          const res = await fetch(`/api/suggest?q=${encodeURIComponent(label)}`);
          const matches = (await res.json()) as ResolvedLine["match"][];
          return { label, match: matches[0] ?? null };
        } catch {
          return { label, match: null };
        }
      }),
    );
    setLines(results);
    setSkipped(new Set());
    setState("preview");
  }

  function commit() {
    createCart(r.name);
    let added = 0;
    lines.forEach((l, i) => {
      if (skipped.has(i) || !l.match) return;
      addItem({ slug: l.match.slug, name: l.match.name, qty: 1 });
      added++;
    });
    setState("added");
  }

  if (state === "added") {
    return (
      <div className="card" style={{ padding: 16 }}>
        <div style={{ fontWeight: 700 }}>{r.name}</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
          <span className="muted">✓ adăugat</span>
          <Link href="/lista" className="btn btn-accent btn-sm">Vezi coșul →</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontWeight: 700 }}>{r.name}</div>
      {r.note && <p className="muted" style={{ fontSize: 13, margin: "4px 0" }}>{r.note}</p>}
      <p className="muted" style={{ fontSize: 12 }}>de {r.username} · {r.ingredients.join(" · ")}</p>

      {state === "preview" ? (
        <div style={{ marginTop: 8 }}>
          <ul className="recipe-lines">
            {lines.map((l, i) => (
              <li key={i} style={{ opacity: skipped.has(i) ? 0.5 : 1 }}>
                {l.match ? (
                  <>
                    <Link href={`/p/${l.match.slug}`}>{l.match.name}</Link>
                    <span className="muted"> — pentru &quot;{l.label}&quot;</span>
                  </>
                ) : (
                  <span className="muted">nimic găsit pentru &quot;{l.label}&quot;</span>
                )}
                {l.match && (
                  <button
                    type="button"
                    className="linklike"
                    style={{ marginLeft: 8, fontSize: 12 }}
                    onClick={() => setSkipped((s) => { const next = new Set(s); next.has(i) ? next.delete(i) : next.add(i); return next; })}
                  >
                    {skipped.has(i) ? "adaugă" : "omite"}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
            Potrivire prin căutare, nu echivalențe verificate ca la rețetele noastre — verifică
            fiecare înainte să adaugi.
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button type="button" className="btn btn-accent btn-sm" onClick={commit}>Adaugă în coș</button>
            <button type="button" className="linklike" onClick={() => setState("idle")}>Renunță</button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 8 }} onClick={resolve} disabled={state === "loading"}>
          {state === "loading" ? "Se caută…" : "Vezi ce găsim"}
        </button>
      )}
    </div>
  );
}

export function UserRecipes() {
  const [recipes, setRecipes] = useState<Recipe[] | null>(null);

  function load() {
    fetch("/api/user-recipes")
      .then((r) => r.json())
      .then((j: { recipes?: Recipe[] }) => setRecipes(j.recipes ?? []))
      .catch(() => setRecipes([]));
  }
  useEffect(load, []);

  return (
    <div>
      <SubmitForm onSubmitted={load} />
      {recipes === null ? null : recipes.length === 0 ? (
        <div className="empty" style={{ marginTop: 12 }}>Nicio rețetă trimisă încă.</div>
      ) : (
        <div className="grid-products" style={{ marginTop: 16 }}>
          {recipes.map((r) => <RecipeCard key={r.id} r={r} />)}
        </div>
      )}
    </div>
  );
}
