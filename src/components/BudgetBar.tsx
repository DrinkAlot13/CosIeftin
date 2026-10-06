"use client";
// Shows the CURRENT list's total against the shopper's monthly budget, if they set one. Reads
// `cosmic_basket_snap` (basket-trend.ts's own key, already disclosed in confidentialitate),
// which ListBuilder writes via `snapshotBasket()` every time it recomputes — this reads it
// rather than fetching /api/basket a second time for the same number.
//
// THIS IS NOT A SPENDING TRACKER. We have no record of what a shopper actually bought, only
// what their current list would cost right now. Framed as "coșul tău de azi", never as
// "spent this month" — a false running total is worse than none.
import { useEffect, useState } from "react";
import { CART_EVENT } from "@/lib/carts";

const SNAP_KEY = "cosmic_basket_snap";

function readTodaysTotal(): number | null {
  try {
    const s = JSON.parse(localStorage.getItem(SNAP_KEY) || "{}");
    const today = new Date().toISOString().slice(0, 10);
    return typeof s[today] === "number" && s[today] > 0 ? s[today] : null;
  } catch {
    return null;
  }
}

export function BudgetBar() {
  const [budgetBani, setBudgetBani] = useState<number | null | undefined>(undefined);
  const [cartLei, setCartLei] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/budget")
      .then((r) => r.json())
      .then((j: { signedIn: boolean; monthlyLimitBani: number | null }) => setBudgetBani(j.signedIn ? j.monthlyLimitBani : null))
      .catch(() => setBudgetBani(null));

    setCartLei(readTodaysTotal());
    // ListBuilder recomputes and writes the snapshot asynchronously after a cart change, so a
    // short delay gives it time to land rather than reading the stale pre-change total.
    const onCartChange = () => setTimeout(() => setCartLei(readTodaysTotal()), 1500);
    window.addEventListener(CART_EVENT, onCartChange);
    window.addEventListener("storage", onCartChange);
    return () => {
      window.removeEventListener(CART_EVENT, onCartChange);
      window.removeEventListener("storage", onCartChange);
    };
  }, []);

  if (!budgetBani || cartLei == null) return null;

  const budgetLei = budgetBani / 100;
  const pct = Math.min(100, (cartLei / budgetLei) * 100);
  const over = cartLei > budgetLei;

  return (
    <div className="pill-note" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
        <span>Coșul tău de azi: <b>{cartLei.toFixed(2)} lei</b></span>
        <span className="muted">buget lunar {budgetLei.toFixed(0)} lei</span>
      </div>
      <div style={{ height: 8, background: "var(--border)", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: over ? "var(--danger)" : "var(--accent)", borderRadius: 4 }} />
      </div>
      {over && <p className="muted" style={{ fontSize: 12, marginTop: 4, marginBottom: 0 }}>Coșul de azi trece de bugetul lunar.</p>}
    </div>
  );
}
