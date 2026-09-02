"use client";
// The full basket as it would be at ONE shop.
//
// Reached from "Completează coșul la <shop>" on any shop row. It is a separate view rather than
// a filter over the comparison table because it answers a different question: not "where is this
// cheapest" but "if I go here, what do I come home with and what do I actually pay".
//
// Three things the comparison table cannot show and this must:
//   · every substitution, named, with the price difference per unit;
//   · the REAL total — goods + SGR deposits + delivery — because "7/18 items" hides both;
//   · which lines have nothing equivalent here at all, separately from lines we substituted.
//
// "Păstrează originalul" pins a line to EXACT and re-resolves. The shopper disagreeing with a
// substitution is the point: the engine proposes, they decide, and the decision survives.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CART_EVENT, getActive } from "@/lib/carts";

type Line = {
  slug: string;
  qty: number;
  requestedName: string;
  status: "EXACT" | "SUBSTITUTED" | "UNAVAILABLE";
  chosen: { offerId: number; productId: number; name: string; brand: string | null; priceBani: number; packs: number } | null;
  totalBani: number;
  depositBani: number;
  explanation: { headline: string; detail?: string; tone: "neutral" | "good" | "warn" };
  canPinOriginal: boolean;
};

type Payload = {
  merchant: { slug: string; name: string; storeType: string; websiteUrl: string | null; minOrderBani: number | null };
  lines: Line[];
  summary: {
    itemCount: number; found: number; substituted: number; unavailable: number;
    goodsBani: number; depositsBani: number; deliveryBani: number; totalBani: number;
    belowMinOrder: boolean;
  };
};

const lei = (bani: number) => `${(bani / 100).toFixed(2).replace(".", ",")} lei`;

export function ShopBasket({ shopSlug }: { shopSlug: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Lines the shopper pinned back to the original product, kept client-side so the choice
  // survives a re-resolve without needing an account.
  const [pinned, setPinned] = useState<Set<string>>(new Set());

  const run = useCallback(async (pins: Set<string>) => {
    setLoading(true);
    setError(null);
    const cart = getActive();
    if (cart.items.length === 0) { setData(null); setLoading(false); return; }
    try {
      const r = await fetch("/api/basket/shop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          merchantSlug: shopSlug,
          items: cart.items.map((i) => ({ slug: i.slug, qty: i.qty, mode: pins.has(i.slug) ? "EXACT" : "EQUIVALENT" })),
        }),
      });
      const j = await r.json();
      if (!r.ok) { setError(j.error ?? "Ceva n-a mers."); setData(null); }
      else setData(j as Payload);
    } catch {
      setError("Nu am putut calcula coșul.");
    } finally {
      setLoading(false);
    }
  }, [shopSlug]);

  useEffect(() => {
    void run(pinned);
    const sync = () => void run(pinned);
    window.addEventListener(CART_EVENT, sync);
    return () => window.removeEventListener(CART_EVENT, sync);
  }, [run, pinned]);

  function pinOriginal(slug: string) {
    setPinned((prev) => { const next = new Set(prev); next.add(slug); return next; });
  }
  function unpin(slug: string) {
    setPinned((prev) => { const next = new Set(prev); next.delete(slug); return next; });
  }

  if (loading && !data) return <div className="empty">Se calculează coșul…</div>;
  if (error) return <div className="empty">{error}</div>;
  if (!data) return <div className="empty">Coșul tău este gol. <Link href="/">Adaugă produse</Link>.</div>;

  const { merchant, lines, summary } = data;

  return (
    <div>
      <div className="result-cards" style={{ marginBottom: 16 }}>
        <div className="card result-card best">
          <div className="rc-label">🧾 Total real la {merchant.name}</div>
          <div className="rc-total">{lei(summary.totalBani)}</div>
          <div className="muted">
            {lei(summary.goodsBani)} produse
            {summary.depositsBani > 0 && <> · {lei(summary.depositsBani)} garanție SGR</>}
            {summary.deliveryBani > 0 && <> · {lei(summary.deliveryBani)} livrare</>}
          </div>
        </div>
        <div className="card result-card">
          <div className="rc-label">📦 Acoperire</div>
          <div className="rc-total" style={{ fontSize: 24 }}>{summary.found}/{summary.itemCount}</div>
          <div className="muted">
            {summary.substituted > 0 && <>{summary.substituted} înlocuite</>}
            {summary.substituted > 0 && summary.unavailable > 0 && " · "}
            {summary.unavailable > 0 && <>{summary.unavailable} lipsesc</>}
            {summary.substituted === 0 && summary.unavailable === 0 && "totul exact cum ai cerut"}
          </div>
        </div>
      </div>

      {summary.belowMinOrder && merchant.minOrderBani != null && (
        <div className="pill-note" style={{ marginBottom: 12 }}>
          Sub comanda minimă de <b>{lei(merchant.minOrderBani)}</b> la {merchant.name}.
        </div>
      )}

      <div className="card" style={{ overflowX: "auto" }}>
        <table className="admin-table">
          <thead>
            <tr><th>Ai cerut</th><th>Primești</th><th className="num">Preț</th><th></th></tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.slug} className={l.status === "UNAVAILABLE" ? "line-missing" : undefined}>
                <td>
                  <div style={{ fontWeight: 600 }}>{l.requestedName}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {l.qty} buc{pinned.has(l.slug) && " · fixat exact"}
                  </div>
                </td>
                <td>
                  {l.chosen ? (
                    <>
                      <div style={{ fontWeight: l.status === "SUBSTITUTED" ? 600 : 400 }}>
                        {l.chosen.name}
                        {l.chosen.packs > 1 && <span className="muted"> ×{l.chosen.packs}</span>}
                      </div>
                      <div className={`sub-note ${l.explanation.tone}`}>{l.explanation.headline}</div>
                      {l.explanation.detail && <div className="muted" style={{ fontSize: 12 }}>{l.explanation.detail}</div>}
                    </>
                  ) : (
                    <>
                      <div className="muted">—</div>
                      <div className="sub-note warn">{l.explanation.headline}</div>
                      {l.explanation.detail && <div className="muted" style={{ fontSize: 12 }}>{l.explanation.detail}</div>}
                    </>
                  )}
                </td>
                <td className="num" style={{ whiteSpace: "nowrap", fontWeight: 700 }}>
                  {l.totalBani > 0 ? lei(l.totalBani) : "—"}
                  {l.depositBani > 0 && <div className="muted" style={{ fontSize: 11.5, fontWeight: 400 }}>+{lei(l.depositBani)} SGR</div>}
                </td>
                <td>
                  {l.canPinOriginal && !pinned.has(l.slug) && (
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => pinOriginal(l.slug)}>
                      Păstrează originalul
                    </button>
                  )}
                  {pinned.has(l.slug) && (
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => unpin(l.slug)}>
                      Acceptă înlocuirea
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
        {merchant.websiteUrl && (
          <a className="btn btn-primary" href={merchant.websiteUrl} target="_blank" rel="nofollow noopener">
            Mergi la {merchant.name} →
          </a>
        )}
        <Link className="btn btn-outline" href="/lista">← Înapoi la comparație</Link>
      </div>
      <p className="muted" style={{ fontSize: 12.5, marginTop: 10, maxWidth: 620 }}>
        Prețurile sunt cele văzute de noi la ultima citire. Garanția SGR se returnează când duci
        ambalajul înapoi — o afișăm separat pentru că o plătești la casă.
      </p>
    </div>
  );
}
