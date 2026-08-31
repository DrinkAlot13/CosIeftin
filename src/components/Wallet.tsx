"use client";

import { useEffect, useState } from "react";
import { addCard, getCards, LOYALTY_STORES, removeCard, type WalletCard, WALLET_EVENT } from "@/lib/cards-wallet";

export function Wallet() {
  const [cards, setCards] = useState<WalletCard[]>([]);
  const [store, setStore] = useState(LOYALTY_STORES[0]);
  const [code, setCode] = useState("");

  useEffect(() => {
    const sync = () => setCards(getCards());
    sync();
    window.addEventListener(WALLET_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(WALLET_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return (
    <div>
      <div className="card" style={{ padding: 14, marginBottom: 16, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select value={store} onChange={(e) => setStore(e.target.value)} aria-label="Magazin">
          {LOYALTY_STORES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Numărul cardului / cod" aria-label="Cod card" style={{ minWidth: 200 }} />
        <button
          type="button"
          className="btn btn-accent"
          onClick={() => { if (code.trim()) { addCard(store, code); setCode(""); } }}
        >
          Salvează
        </button>
      </div>

      {cards.length === 0 ? (
        <div className="empty">Niciun card salvat. Adaugă cardurile tale de fidelitate mai sus.</div>
      ) : (
        <div className="grid-products">
          {cards.map((c) => (
            <div key={c.store} className="card" style={{ padding: 16, textAlign: "center" }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>{c.store}</div>
              <div style={{ fontFamily: "monospace", fontSize: 22, letterSpacing: 3, wordBreak: "break-all", background: "var(--surface-2, #f3f3f3)", padding: "10px 8px", borderRadius: 8 }}>
                {c.code}
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Arată la casă</div>
              <button type="button" className="linklike" style={{ marginTop: 8 }} onClick={() => removeCard(c.store)}>Șterge</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
