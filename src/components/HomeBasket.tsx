"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatRON } from "@/lib/format";

/**
 * ── THE HOMEPAGE ANSWERS A QUESTION INSTEAD OF DESCRIBING A CATALOG.
 *
 * Nobody wants to browse 29,000 products. At basket level comparability barely matters, because
 * the optimizer handles missing lines — a real total is a real answer even when half the items
 * sit at one shop. So the homepage leads with a basket that is already filled, and the headline
 * is the answer: "coșul tău costă 312 lei la Auchan".
 *
 * ── A SHOP THAT CANNOT SUPPLY THE BASKET IS NOT CHEAPER. IT IS INCOMPLETE.
 *
 * This is the whole risk of a basket-first page. A shop holding 3 of 8 lines will always show a
 * smaller number than a shop holding 8, and sorting by that number puts the least useful shop
 * first with the most attractive figure. So the headline is drawn ONLY from shops that have
 * every line, incomplete shops are listed under their own heading with what they are missing,
 * and their totals are never compared against a complete one.
 */

export type Staple = { key: string; label: string; slug: string; shopCount: number };

type StoreTotal = {
  merchantId: number; slug: string; name: string; storeType: string | null;
  subtotal: number; deliveryFee: number; total: number; missing: number; itemsFound: number;
  belowMinOrder: boolean; minOrder: number | null;
};
type Result = {
  storeTotals: StoreTotal[];
  bestComplete: StoreTotal | null;
  splitTotal: number;
  storesInSplit: number;
  itemCount: number;
};

export function HomeBasket({ staples }: { staples: Staple[] }) {
  // Pre-filled: everything on. "Thirty seconds" means editing a basket that already exists,
  // not building one from nothing.
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(staples.map((s) => s.slug)));
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const slugs = useMemo(() => staples.filter((s) => chosen.has(s.slug)).map((s) => s.slug), [staples, chosen]);
  const key = slugs.join(",");

  useEffect(() => {
    if (slugs.length === 0) { setResult(null); return; }
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    fetch("/api/basket", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: slugs.map((slug) => ({ slug, qty: 1 })) }),
    })
      .then((r) => r.json())
      .then((d: Result) => { if (!cancelled) { setResult(d); setLoading(false); } })
      .catch(() => { if (!cancelled) { setLoading(false); setFailed(true); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const n = slugs.length;
  // ── "CAN I ACTUALLY BUY THIS BASKET HERE?" HAS TWO WAYS OF BEING NO.
  //
  // Missing lines is the obvious one. BELOW THE MINIMUM ORDER is the other, and it bites the
  // same way: the first render of this page put "67,47 RON la Mega Image" in the headline while
  // the table underneath listed Auchan at 67,18 — cheaper, and unorderable, because the basket
  // was under Auchan's minimum. A shop you cannot order from is not a cheaper shop.
  //
  // So "usable" means every line AND an order the shop will accept. `bestComplete` from the API
  // already applies both; this list has to agree with it or the headline and the table below it
  // contradict each other, which is what happened.
  const usable = (result?.storeTotals ?? [])
    .filter((s) => s.missing === 0 && !s.belowMinOrder)
    .sort((a, b) => a.total - b.total);
  const unusable = (result?.storeTotals ?? [])
    .filter((s) => s.missing > 0 || s.belowMinOrder)
    .sort((a, b) => a.missing - b.missing);
  const best = result?.bestComplete ?? usable[0] ?? null;
  const runnerUp = usable.find((s) => s.merchantId !== best?.merchantId) ?? null;

  return (
    <div className="home-basket">
      <div className="hb-items">
        <div className="hb-items-head">
          Coșul de bază — bifează ce cumperi
          <span className="muted"> ({n} din {staples.length})</span>
        </div>
        <ul className="hb-list">
          {staples.map((s) => {
            const on = chosen.has(s.slug);
            return (
              <li key={s.slug}>
                <label>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => setChosen((prev) => {
                      const next = new Set(prev);
                      if (next.has(s.slug)) next.delete(s.slug); else next.add(s.slug);
                      return next;
                    })}
                  />
                  <span className={on ? "" : "muted"}>{s.label}</span>
                </label>
              </li>
            );
          })}
        </ul>
        <Link className="linklike" href="/lista">Adaugă alte produse în lista ta →</Link>
      </div>

      <div className="hb-answer" aria-live="polite">
        {n === 0 && <div className="pill-note">Bifează cel puțin un produs.</div>}
        {n > 0 && loading && !result && <div className="pill-note">Se calculează…</div>}
        {failed && <div className="pill-note">Nu am putut calcula acum. Încearcă din nou.</div>}

        {n > 0 && result && best && (
          <>
            <div className="hb-head">Coșul tău costă</div>
            <div className="hb-big">
              {formatRON(best.total)} <span className="hb-at">la {best.name}</span>
            </div>
            {runnerUp && (
              <div className="hb-second">
                {formatRON(runnerUp.total)} la {runnerUp.name}
                {runnerUp.total > best.total && (
                  <span className="muted"> · cu {formatRON(runnerUp.total - best.total)} mai mult</span>
                )}
              </div>
            )}
            <div className="muted hb-note">
              {n} {n === 1 ? "produs" : "produse"} · include livrarea unde e cazul.
              {/* The split total is shown ONLY when splitting actually costs less. Printing a
                  higher number beside the answer reads as a second, worse recommendation. */}
              {result.storesInSplit > 1 && result.splitTotal < best.total && (
                <> Împărțit în {result.storesInSplit} magazine: {formatRON(result.splitTotal)}.</>
              )}
            </div>

            {usable.length > 1 && (
              <table className="hb-table">
                <tbody>
                  {usable.slice(0, 5).map((s) => (
                    <tr key={s.merchantId} className={s.merchantId === best.merchantId ? "best" : undefined}>
                      <td>{s.name}</td>
                      <td className="num">{formatRON(s.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* INCOMPLETE SHOPS, UNDER THEIR OWN HEADING, WITH THEIR TOTAL DELIBERATELY ABSENT.
                Printing "34,10 RON" next to "îi lipsesc 5 produse" invites exactly the comparison
                the heading is trying to prevent — the eye reads the number, not the caveat. */}
            {unusable.length > 0 && (
              <details className="hb-incomplete">
                <summary className="muted">
                  {unusable.length} {unusable.length === 1 ? "magazin nu poate" : "magazine nu pot"} livra tot coșul
                </summary>
                <ul>
                  {unusable.slice(0, 6).map((s) => (
                    <li key={s.merchantId} className="muted">
                      {s.name} —{" "}
                      {s.missing > 0
                        ? `are ${s.itemsFound} din ${n}, îi lipsesc ${s.missing}`
                        : `sub comanda minimă${s.minOrder ? ` (${s.minOrder} RON)` : ""}`}
                    </li>
                  ))}
                </ul>
                <p className="muted" style={{ fontSize: 12.5, margin: "6px 0 0" }}>
                  Nu le arătăm un total: un magazin căruia îi lipsesc produse — sau la care nu
                  poți plasa comanda — nu e mai ieftin, e indisponibil.
                </p>
              </details>
            )}
          </>
        )}

        {n > 0 && result && !best && !loading && (
          // Every shop is missing something. Saying "cheapest: X" here would be false.
          <div className="pill-note">
            Niciun magazin nu are tot coșul. Scoate un produs sau două, sau{" "}
            <Link href="/lista">împarte coșul în lista ta</Link>.
          </div>
        )}
      </div>
    </div>
  );
}
