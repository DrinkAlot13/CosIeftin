"use client";
// Set or clear the monthly grocery budget shown on /lista (BudgetBar.tsx). Lives on /cont so
// there is exactly one place to change it, not a form duplicated on every page that reads it.
import { useEffect, useState } from "react";

export function BudgetSettings() {
  const [current, setCurrent] = useState<number | null | undefined>(undefined); // undefined = loading
  const [input, setInput] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/budget")
      .then((r) => r.json())
      .then((j: { monthlyLimitBani: number | null }) => {
        setCurrent(j.monthlyLimitBani);
        if (j.monthlyLimitBani != null) setInput((j.monthlyLimitBani / 100).toFixed(0));
      })
      .catch(() => setCurrent(null));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const lei = Number(input.replace(",", "."));
    if (!Number.isFinite(lei) || lei <= 0) return;
    const bani = Math.round(lei * 100);
    await fetch("/api/budget", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ monthlyLimitBani: bani }) });
    setCurrent(bani);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function clear() {
    await fetch("/api/budget", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ monthlyLimitBani: null }) });
    setCurrent(null);
    setInput("");
  }

  if (current === undefined) return null;

  return (
    <div>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        Opțional. Dacă setezi un buget lunar, pe pagina listei tale vezi cât din buget reprezintă
        coșul curent — nu urmărim ce cumperi efectiv în magazin, doar costul listei de azi.
      </p>
      <form onSubmit={save} className="auth-form" style={{ maxWidth: 320, flexDirection: "row", gap: 8 }}>
        <input type="text" inputMode="decimal" value={input} onChange={(e) => setInput(e.target.value)} placeholder="ex: 1200" aria-label="Buget lunar în lei" style={{ flex: 1 }} />
        <button className="btn btn-outline" type="submit">{current != null ? "Actualizează" : "Setează"}</button>
        {current != null && <button className="btn btn-outline" type="button" onClick={clear}>Șterge</button>}
      </form>
      {saved && <p className="alert-ok" style={{ fontSize: 13, marginTop: 4 }}>Salvat.</p>}
    </div>
  );
}
