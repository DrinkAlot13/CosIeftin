"use client";

import { useEffect, useState } from "react";
import { addCard, getCards, LOYALTY_STORES, removeCard, type WalletCard, WALLET_EVENT } from "@/lib/cards-wallet";

export function Wallet() {
  /**
   * `null` means NOT READ YET. It is not the same as "read, and there are none".
   *
   * This was `useState<WalletCard[]>([])`, so between mount and the effect a shopper who has
   * saved cards was told "Niciun card salvat" — for one frame, on their own wallet page. Small,
   * and the same shape as the 3-second image timer that blanked 421 of 494 cards: an initial
   * value doubling as an answer. localStorage is read synchronously, so the honest state before
   * that read is "we do not know yet", and the honest thing to render is nothing.
   */
  const [cards, setCards] = useState<WalletCard[] | null>(null);
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

      {cards === null ? null : cards.length === 0 ? (
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
