"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatRON } from "@/lib/format";

const KEY = "cosmic_list";
type LItem = { slug: string; name: string; qty: number };
type Suggestion = { slug: string; name: string; brand: string | null; lowest: number };

type Cheapest = { merchantId: number; merchantName: string; merchantSlug: string; unitPrice: number; linePrice: number };
type PerItem = { productId: number; slug: string; name: string; qty: number; cheapest: Cheapest | null };
type StoreTotal = { merchantId: number; slug: string; name: string; color: string | null; total: number; missing: number; itemsFound: number };
type Result = {
  perItem: PerItem[];
  splitTotal: number;
  storeTotals: StoreTotal[];
  bestComplete: StoreTotal | null;
  storesInSplit: number;
  savings: number | null;
  itemCount: number;
};

function read(): LItem[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}
function write(items: LItem[]) {
  localStorage.setItem(KEY, JSON.stringify(items));
  window.dispatchEvent(new Event("cosmic-list"));
}

export function ListBuilder() {
  const [items, setItems] = useState<LItem[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [sug, setSug] = useState<Suggestion[]>([]);

  useEffect(() => {
    const sync = () => setItems(read());
    sync();
    window.addEventListener("cosmic-list", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("cosmic-list", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  // Recompute the basket whenever the items change.
  useEffect(() => {
    if (items.length === 0) {
      setResult(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch("/api/basket", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: items.map((i) => ({ slug: i.slug, qty: i.qty })) }),
    })
      .then((r) => r.json())
      .then((d: Result) => {
        if (!cancelled) {
          setResult(d);
          setLoading(false);
        }
      })
      .catch(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [items]);

  // Suggestions for the add box.
  useEffect(() => {
    if (q.trim().length < 2) {
      setSug([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/suggest?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then(setSug)
        .catch(() => {});
    }, 150);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const setQty = (slug: string, qty: number) => {
    const next = read().map((i) => (i.slug === slug ? { ...i, qty: Math.max(1, Math.min(99, qty)) } : i));
    write(next);
    setItems(next);
  };
  const remove = (slug: string) => {
    const next = read().filter((i) => i.slug !== slug);
    write(next);
    setItems(next);
  };
  const add = (s: Suggestion) => {
    if (read().some((i) => i.slug === s.slug)) return;
    const next = [...read(), { slug: s.slug, name: s.name, qty: 1 }];
    write(next);
    setItems(next);
    setQ("");
    setSug([]);
  };
  const clear = () => {
    write([]);
    setItems([]);
  };

  const perItemBySlug = useMemo(() => new Map((result?.perItem ?? []).map((pi) => [pi.slug, pi])), [result]);

  return (
    <div className="lista-layout">
      <div className="card lista-items">
        <div className="lista-add">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Adaugă un produs (ex. lapte, ulei, ouă)…"
            aria-label="Adaugă produs"
            autoComplete="off"
          />
          {sug.length > 0 && (
            <ul className="suggest lista-suggest">
              {sug.map((s) => (
                <li key={s.slug}>
                  <button type="button" onClick={() => add(s)}>
                    <span className="s-name">{s.brand ? <span className="s-brand">{s.brand} </span> : null}{s.name}</span>
                    <span className="s-price">de la {formatRON(s.lowest)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {items.length === 0 ? (
          <div className="empty" style={{ padding: "40px 12px" }}>Lista e goală. Caută și adaugă produse mai sus.</div>
        ) : (
          <>
            <ul className="lista-list">
              {items.map((it) => {
                const pi = perItemBySlug.get(it.slug);
                return (
                  <li key={it.slug} className="lista-row">
                    <div className="lr-name">
                      <Link href={`/p/${it.slug}`}>{it.name}</Link>
                      {pi?.cheapest ? (
                        <div className="muted lr-cheap">
                          cel mai ieftin: <b>{pi.cheapest.merchantName}</b> · {formatRON(pi.cheapest.linePrice)}
                        </div>
                      ) : (
                        <div className="muted lr-cheap">indisponibil în magazinele monitorizate</div>
                      )}
                    </div>
                    <div className="qty">
                      <button type="button" onClick={() => setQty(it.slug, it.qty - 1)} aria-label="minus">−</button>
                      <span>{it.qty}</span>
                      <button type="button" onClick={() => setQty(it.slug, it.qty + 1)} aria-label="plus">+</button>
                    </div>
                    <button type="button" className="lr-remove" onClick={() => remove(it.slug)} aria-label="Șterge">×</button>
                  </li>
                );
              })}
            </ul>
            <div style={{ padding: "8px 4px 0" }}>
              <button className="linklike" onClick={clear}>Golește lista</button>
            </div>
          </>
        )}
      </div>

      <div className="lista-results">
        {items.length === 0 && <div className="pill-note">Adaugă produse ca să vezi unde e cel mai ieftin coșul tău.</div>}
        {loading && items.length > 0 && !result && <div className="pill-note">Se calculează…</div>}
        {result && items.length > 0 && (
          <>
            <div className="result-cards">
              <div className="card result-card">
                <div className="rc-label">🏪 Cel mai ieftin într-un magazin</div>
                {result.bestComplete ? (
                  <>
                    <div className="rc-store">{result.bestComplete.name}</div>
                    <div className="rc-total">{formatRON(result.bestComplete.total)}</div>
                    <div className="muted">toate cele {result.itemCount} produse · o singură tură</div>
                  </>
                ) : result.storeTotals[0] ? (
                  <>
                    <div className="rc-store">{result.storeTotals[0].name}</div>
                    <div className="rc-total">{formatRON(result.storeTotals[0].total)}</div>
                    <div className="muted">are {result.storeTotals[0].itemsFound}/{result.itemCount} · lipsesc {result.storeTotals[0].missing}</div>
                  </>
                ) : (
                  <div className="muted">—</div>
                )}
              </div>
              <div className="card result-card best">
                <div className="rc-label">🧩 Cel mai ieftin împărțit</div>
                <div className="rc-store">{result.storesInSplit} {result.storesInSplit === 1 ? "magazin" : "magazine"}</div>
                <div className="rc-total">{formatRON(result.splitTotal)}</div>
                <div className="muted">fiecare produs de unde e cel mai ieftin</div>
              </div>
            </div>

            {result.savings != null && result.savings > 0.005 ? (
              <div className="save-note">💰 Economisești <b>{formatRON(result.savings)}</b> dacă mergi în {result.storesInSplit} magazine în loc de unul.</div>
            ) : result.bestComplete ? (
              <div className="save-note muted">Un singur magazin ({result.bestComplete.name}) e la fel de bun ca împărțirea — o singură tură.</div>
            ) : null}

            <div className="card" style={{ overflowX: "auto", marginTop: 16 }}>
              <table className="admin-table">
                <thead><tr><th>Magazin</th><th>Total coș</th><th>Acoperire</th></tr></thead>
                <tbody>
                  {result.storeTotals.map((st) => (
                    <tr key={st.merchantId}>
                      <td style={{ fontWeight: 600 }}>{st.name}</td>
                      <td style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{formatRON(st.total)}</td>
                      <td className="muted">{st.itemsFound}/{result.itemCount}{st.missing > 0 ? ` (lipsesc ${st.missing})` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
