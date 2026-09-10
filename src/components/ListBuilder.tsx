"use client";

import { isShelfPrice, normalizePriceSource } from "@/lib/price-source";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { loadBasket, saveBasket } from "@/lib/offline-cache";
import { InstallPrompt } from "@/components/InstallPrompt";
import {
  addItem,
  CART_EVENT,
  type Cart,
  clearActive,
  createCart,
  deleteCart,
  getActive,
  getCarts,
  removeItem,
  renameCart,
  setActive,
  setQty,
} from "@/lib/carts";
import { getPreferred, PREF_EVENT } from "@/lib/stores-pref";
import { basketTrend, snapshotBasket } from "@/lib/basket-trend";
import { StorePrefs } from "@/components/StorePrefs";
import { StoreTypeBadge } from "@/components/StoreTypeBadge";
import { formatRON } from "@/lib/format";

type Store = { slug: string; name: string; color: string | null };
type Suggestion = { slug: string; name: string; brand: string | null; lowest: number };

type Cheapest = {
  merchantId: number; merchantName: string; merchantSlug: string;
  unitPrice: number; linePrice: number; loyalty?: boolean; priceSource?: string;
  /** set when this line's quantity reached a quantity-discount rung */
  bulk?: { fromQty: number; unitPrice: number; savedOnLine: number } | null;
  /** SGR deposit for this line, in lei — paid at the till, refunded on return */
  depositLine?: number;
  /** the next rung, only when reaching it costs LESS IN TOTAL than the current quantity */
  nextRung?: { addUnits: number; atQty: number; newUnitPrice: number; savesTotal: number } | null;
};
type PerItem = { productId: number; slug: string; name: string; qty: number; cheapest: Cheapest | null };
type StoreTotal = {
  merchantId: number; slug: string; name: string; color: string | null; storeType: string | null;
  subtotal: number; deliveryFee: number; total: number; missing: number; itemsFound: number;
  belowMinOrder: boolean; minOrder: number | null; needForMinOrder: number | null; needForFreeDelivery: number | null;
  usesLoyalty: boolean; priceSource: string;
};
type Result = {
  perItem: PerItem[];
  splitTotal: number;
  /** SGR deposits across the basket, in lei. Separate from splitTotal on purpose. */
  totalDeposit?: number;
  splitGoods: number;
  splitDelivery: number;
  storeTotals: StoreTotal[];
  bestComplete: StoreTotal | null;
  bestBlockedByMinOrder: StoreTotal | null;
  storesInSplit: number;
  savings: number | null;
  itemCount: number;
  useLoyalty: boolean;
};

export function ListBuilder({ stores = [] }: { stores?: Store[] }) {
  const [carts, setCarts] = useState<Cart[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [result, setResult] = useState<Result | null>(null);
  // When the network fails in a shop, the totals fall back to the last ones computed for THIS
  // exact list — always carrying their age, so the banner cannot fail to say how old they are.
  const [staleAge, setStaleAge] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // ── PLATFORM PRICES IN THE BASKET: OPT-IN, OFF BY DEFAULT.
  //
  // A Bucharest shopper can genuinely order Kaufland through Glovo, so this is a real option and
  // not a trick — but a basket total is a recommendation to spend money at one shop, and the
  // markup is invisible once it is summed. Measured medians: +11.8% glovo-kaufland, +23.8%
  // glovo-profi, −1.0% glovo-penny. Off unless asked for, and the label says what it changes.
  const [withGlovo, setWithGlovo] = useState(false);
  const [q, setQ] = useState("");
  const [sug, setSug] = useState<Suggestion[]>([]);
  const [pref, setPref] = useState<string[]>([]);
  const [strict, setStrict] = useState<"same-brand" | "equivalent">("equivalent");
  const [alts, setAlts] = useState<Record<string, { slug: string; name: string; brand: string | null; lowest: number; store: string | null } | null>>({});

  useEffect(() => {
    const sync = () => setPref(getPreferred());
    sync();
    window.addEventListener(PREF_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(PREF_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const activeCart = carts.find((c) => c.id === activeId) ?? carts[0];
  const items = activeCart?.items ?? [];

  useEffect(() => {
    const sync = () => {
      setCarts(getCarts());
      setActiveId(getActive().id);
    };
    sync();
    window.addEventListener(CART_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CART_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  // Recompute the basket whenever the active cart's items change.
  const itemsKey = useMemo(() => items.map((i) => `${i.slug}:${i.qty}`).join("|"), [items]);
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
      body: JSON.stringify({
        items: items.map((i) => ({ slug: i.slug, qty: i.qty })),
        includeDeliveryPlatform: withGlovo,
      }),
    })
      .then((r) => r.json())
      .then((d: Result) => {
        if (!cancelled) {
          setResult(d);
          setStaleAge(null);
          setLoading(false);
          snapshotBasket(d.splitTotal);
          saveBasket(`${itemsKey}${withGlovo ? "|glovo" : ""}`, d);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
        // Offline, or the server is down. Show what we last computed for this same list.
        const cached = loadBasket<Result>(`${itemsKey}${withGlovo ? "|glovo" : ""}`);
        if (cached) {
          setResult(cached.result);
          setStaleAge(cached.freshness.label);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey, withGlovo]);

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

  // Similar items in other shops for each cart line (esp. single-shop items).
  useEffect(() => {
    if (items.length === 0) { setAlts({}); return; }
    let cancelled = false;
    fetch("/api/alternatives", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slugs: items.map((i) => i.slug), strictness: strict }),
    })
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setAlts(d); })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey, strict]);

  const add = (s: Suggestion) => {
    addItem({ slug: s.slug, name: s.name, qty: 1 });
    setQ("");
    setSug([]);
  };

  const renameActive = () => {
    if (!activeCart) return;
    const name = window.prompt("Redenumește lista:", activeCart.name);
    if (name != null) renameCart(activeCart.id, name);
  };
  const removeActive = () => {
    if (!activeCart) return;
    if (window.confirm(`Ștergi lista „${activeCart.name}”?`)) deleteCart(activeCart.id);
  };

  const perItemBySlug = useMemo(() => new Map((result?.perItem ?? []).map((pi) => [pi.slug, pi])), [result]);
  const prefSet = useMemo(() => new Set(pref), [pref]);
  const sortedStoreTotals = useMemo(() => {
    const rows = result?.storeTotals ?? [];
    return [...rows].sort((a, b) => (prefSet.has(b.slug) ? 1 : 0) - (prefSet.has(a.slug) ? 1 : 0));
  }, [result, prefSet]);
  const bestPreferred = useMemo(() => {
    if (!result || prefSet.size === 0) return null;
    const mine = result.storeTotals.filter((s) => prefSet.has(s.slug));
    const complete = mine.filter((s) => s.missing === 0);
    return (complete.length ? complete : mine).sort((a, b) => a.total - b.total)[0] ?? null;
  }, [result, prefSet]);

  return (
    <div>
      <StorePrefs stores={stores} />

      {/* How far we may substitute. Brand loyalty is real — some people want a cheaper
          coffee, others want THEIR coffee cheaper. */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span className="muted" style={{ fontSize: 13 }}>Sugestii de înlocuire:</span>
        <button
          type="button"
          className={strict === "equivalent" ? "chip active" : "chip"}
          onClick={() => setStrict("equivalent")}
          title="Acceptă orice produs echivalent, chiar de altă marcă"
        >
          Orice echivalent
        </button>
        <button
          type="button"
          className={strict === "same-brand" ? "chip active" : "chip"}
          onClick={() => setStrict("same-brand")}
          title="Doar aceeași marcă — vrei același produs, mai ieftin"
        >
          Doar aceeași marcă
        </button>
      </div>

      {/* Cart switcher */}
      <div className="cart-tabs" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 14 }}>
        {carts.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setActive(c.id)}
            className={c.id === activeId ? "chip active" : "chip"}
            title={`${c.items.length} produse`}
          >
            {c.name} <span className="muted">({c.items.length})</span>
          </button>
        ))}
        <button type="button" className="chip" onClick={() => createCart()}>+ Listă nouă</button>
        {activeCart && (
          <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button type="button" className="linklike" onClick={renameActive}>Redenumește</button>
            {carts.length > 1 && <button type="button" className="linklike" onClick={removeActive}>Șterge lista</button>}
          </span>
        )}
      </div>

      {/* ── THE WAY INTO THE AISLE. Only once there is something to shop for: a link to an
          in-shop screen for an empty list is a link to an empty screen. */}
      {items.length > 0 && (
        <div style={{ margin: "4px 0 14px" }}>
          <Link className="btn btn-accent" href="/lista/in-magazin" style={{ minHeight: 48, display: "inline-flex", alignItems: "center" }}>
            🛒 Mod magazin — bifează pe raft
          </Link>
        </div>
      )}

      {/* Asked after a list exists, never on arrival — see InstallPrompt for why that matters
          on Chrome specifically, where the event fires exactly once. */}
      <InstallPrompt ready={items.length > 0} />

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
                          <>
                            <div className="muted lr-cheap">
                              cel mai ieftin: <b>{pi.cheapest.merchantName}</b> · {formatRON(pi.cheapest.linePrice)}
                            </div>
                            {/*
                              The line already reached a quantity rung, so the total above IS
                              the discounted total. Saying so matters: an unexplained lower
                              number reads as an error.
                            */}
                            {pi.cheapest.bulk && (
                              <div className="lr-cheap" style={{ color: "var(--primary)", fontSize: 12.5 }}>
                                preț la cantitate: {formatRON(pi.cheapest.bulk.unitPrice)}/buc de la{" "}
                                {pi.cheapest.bulk.fromQty} buc · economisești {formatRON(pi.cheapest.bulk.savedOnLine)}
                              </div>
                            )}
                            {/*
                              And the near-miss. Only shown when the bigger quantity costs LESS
                              IN TOTAL — buying two more to save four bani a unit is an upsell,
                              not a saving, and this site exists not to do that.
                            */}
                            {pi.cheapest.nextRung && (
                              <div className="lr-cheap muted" style={{ fontSize: 12.5 }}>
                                💡 mai adaugă {pi.cheapest.nextRung.addUnits} și plătești{" "}
                                {formatRON(pi.cheapest.nextRung.newUnitPrice)}/buc în loc de{" "}
                                {formatRON(pi.cheapest.unitPrice)} — total cu{" "}
                                {formatRON(pi.cheapest.nextRung.savesTotal)} mai puțin
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="muted lr-cheap">indisponibil în magazinele monitorizate</div>
                        )}
                        {alts[it.slug] && (
                          <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
                            💡 similar: <Link href={`/p/${alts[it.slug]!.slug}`}>{alts[it.slug]!.name}</Link>{alts[it.slug]!.store ? ` la ${alts[it.slug]!.store}` : ""} · {formatRON(alts[it.slug]!.lowest)}{" "}
                            <button type="button" className="linklike" onClick={() => addItem({ slug: alts[it.slug]!.slug, name: alts[it.slug]!.name, qty: 1 })}>+ adaugă</button>
                          </div>
                        )}
                      </div>
                      <div className="qty">
                        <button type="button" onClick={() => setQty(it.slug, it.qty - 1)} aria-label="minus">−</button>
                        <span>{it.qty}</span>
                        <button type="button" onClick={() => setQty(it.slug, it.qty + 1)} aria-label="plus">+</button>
                      </div>
                      <button type="button" className="lr-remove" onClick={() => removeItem(it.slug)} aria-label="Șterge">×</button>
                    </li>
                  );
                })}
              </ul>
              <div style={{ padding: "8px 4px 0" }}>
                <button className="linklike" onClick={clearActive}>Golește lista</button>
              </div>
            </>
          )}
        </div>

        <div className="lista-results">
          {items.length === 0 && <div className="pill-note">Adaugă produse ca să vezi unde e cel mai ieftin coșul tău.</div>}
          {loading && items.length > 0 && !result && <div className="pill-note">Se calculează…</div>}
          {staleAge && (
            <div className="stale-banner" role="status">
              📴 <b>Ești offline.</b> Prețurile de mai jos au fost calculate {staleAge} și pot fi
              diferite acum. Se actualizează singure când revine semnalul.
            </div>
          )}
          {/* THE TOGGLE. Off by default, and the label says what turning it on DOES — not just
              that it exists. "Include" alone would leave a shopper to discover the markup in the
              total, which is the thing the default is protecting them from. */}
          {items.length > 0 && (
            <label className="pill-note" style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={withGlovo}
                onChange={(e) => setWithGlovo(e.target.checked)}
                style={{ marginTop: 3 }}
              />
              <span>
                <b>Include și prețurile prin Glovo</b> (Kaufland, Penny, Profi).
                <br />
                <span className="muted" style={{ fontSize: 12.5 }}>
                  Sunt prețuri de livrare, nu prețuri de raft — de obicei mai mari, uneori egale
                  sau mai mici. Implicit sunt excluse din coș.
                </span>
              </span>
            </label>
          )}
          {result && items.length > 0 && (() => {
            // ── WHICHEVER IS CHEAPER IS THE ONE WE HIGHLIGHT, and only when the two describe
            //    the SAME basket.
            //
            // `best` used to be hard-coded on the split card. Somebody used the site with twenty
            // staples and got "Cel mai ieftin intr-un magazin  Mega Image 267,16 (16/20)" beside
            // a HIGHLIGHTED "Cel mai ieftin impartit  7 magazine 436,03" — 63% MORE expensive,
            // 111,50 of it delivery, with no savings note because the saving was negative. The
            // page showed two numbers, emphasised the larger one, and said nothing.
            //
            // WORSE, THE TWO NUMBERS DESCRIBED DIFFERENT BASKETS: 267,16 was for 16 of 20
            // products and 436,03 for all 20. Nothing said so, so "one shop is cheaper" was a
            // comparison that had never been made.
            const oneStoreTotal = result.bestComplete?.total ?? null;
            const sameBasket = oneStoreTotal !== null;          // only bestComplete has every item
            const splitWins = !sameBasket || result.splitTotal <= oneStoreTotal;
            return (
            <>
              <div className="result-cards">
                <div className={`card result-card${sameBasket && !splitWins ? " best" : ""}`}>
                  <div className="rc-label">🏪 Cel mai ieftin într-un magazin</div>
                  {result.bestComplete ? (
                    <>
                      <div className="rc-store">{result.bestComplete.name}</div>
                      <div className="rc-total">{formatRON(result.bestComplete.total)}</div>
                      <div className="muted">toate cele {result.itemCount} produse · o singură tură</div>
                    </>
                  ) : result.bestBlockedByMinOrder ? (
                    <>
                      <div className="rc-store">{result.bestBlockedByMinOrder.name}</div>
                      <div className="rc-total">{formatRON(result.bestBlockedByMinOrder.total)}</div>
                      <div className="muted">
                        are tot coșul, dar mai adaugă {formatRON(result.bestBlockedByMinOrder.needForMinOrder ?? 0)} ca să atingi comanda minimă
                      </div>
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
                <div className={`card result-card${splitWins ? " best" : ""}`}>
                  <div className="rc-label">🧩 Cel mai ieftin împărțit</div>
                  <div className="rc-store">{result.storesInSplit} {result.storesInSplit === 1 ? "magazin" : "magazine"}</div>
                  <div className="rc-total">{formatRON(result.splitTotal)}</div>
                  {result.totalDeposit != null && result.totalDeposit > 0 && (
                    <div className="muted" style={{ fontSize: 12 }}>
                      + garanție SGR {formatRON(result.totalDeposit)} (se returnează)
                    </div>
                  )}
                  <div className="muted">fiecare produs de unde e cel mai ieftin</div>
                </div>
                {bestPreferred && (
                  <div className="card result-card">
                    <div className="rc-label">📍 În magazinele tale</div>
                    <div className="rc-store">{bestPreferred.name}</div>
                    <div className="rc-total">{formatRON(bestPreferred.total)}</div>
                    <div className="muted">{bestPreferred.itemsFound}/{result.itemCount}{bestPreferred.missing > 0 ? ` · lipsesc ${bestPreferred.missing}` : " · complet"}</div>
                  </div>
                )}
              </div>

              {result.splitDelivery > 0 && (
                <div className="save-note muted">
                  🚚 Totalul împărțit include <b>{formatRON(result.splitDelivery)}</b> livrare — împărțind coșul plătești livrarea la fiecare magazin online.
                </div>
              )}

              {/* ── SAY WHICH IS CHEAPER, INCLUDING WHEN IT IS THE SINGLE SHOP.
                     The old version had a note for "the split saves you money" and a note for
                     "they tie", and NOTHING for the case where splitting costs MORE — which is
                     exactly the case a shopper most needs told, because seven delivery fees are
                     invisible until you add them up. */}
              {!sameBasket ? (
                <div className="save-note muted">
                  ⚖️ Cele două totaluri <b>nu sunt pentru același coș</b>: niciun magazin nu are toate
                  cele {result.itemCount} produse, așa că prețul „într-un magazin" e pentru mai puține
                  produse. Doar totalul împărțit acoperă tot coșul.
                </div>
              ) : result.savings != null && result.savings > 0.005 ? (
                <div className="save-note">💰 Economisești <b>{formatRON(result.savings)}</b> dacă mergi în {result.storesInSplit} magazine în loc de unul.</div>
              ) : oneStoreTotal !== null && result.splitTotal > oneStoreTotal + 0.005 ? (
                <div className="save-note">
                  🏪 <b>Un singur magazin e mai ieftin.</b> {result.bestComplete?.name} are tot coșul cu{" "}
                  <b>{formatRON(result.splitTotal - oneStoreTotal)}</b> mai puțin decât împărțirea în{" "}
                  {result.storesInSplit} magazine{result.splitDelivery > 0 ? " — livrarea plătită de mai multe ori" : ""}.
                </div>
              ) : result.bestComplete ? (
                <div className="save-note muted">Un singur magazin ({result.bestComplete.name}) e la fel de bun ca împărțirea — o singură tură.</div>
              ) : null}

              {(() => {
                const t = basketTrend(result.splitTotal);
                if (!t || Math.abs(t.deltaPct) < 0.5) return null;
                const up = t.deltaPct > 0;
                return <div className="save-note muted">{up ? "📈" : "📉"} Coșul tău e cu <b>{Math.abs(t.deltaPct).toFixed(1)}%</b> {up ? "mai scump" : "mai ieftin"} față de {t.sinceDate}.</div>;
              })()}

              <div className="card" style={{ overflowX: "auto", marginTop: 16 }}>
                <table className="admin-table">
                  <thead><tr><th>Magazin</th><th>Produse</th><th>Livrare</th><th>Total de plată</th><th>Acoperire</th><th></th></tr></thead>
                  <tbody>
                    {sortedStoreTotals.map((st) => {
                      const mine = prefSet.has(st.slug);
                      return (
                        <tr key={st.merchantId} style={mine ? { background: "rgba(0,150,80,.09)" } : undefined}>
                          <td style={{ fontWeight: 600 }}>
                            {mine ? "📍 " : ""}{st.name}
                            <div style={{ marginTop: 2 }}><StoreTypeBadge type={st.storeType} /></div>
                            {st.belowMinOrder && (
                              <div className="muted" style={{ fontSize: 11.5, color: "var(--danger, #b3261e)" }}>
                                sub comanda minimă ({formatRON(st.minOrder ?? 0)})
                              </div>
                            )}
                            {st.priceSource && !isShelfPrice(normalizePriceSource(st.priceSource)) && (
                              <div className="muted" style={{ fontSize: 11.5 }}>preț livrare (poate include adaos)</div>
                            )}
                          </td>
                          <td style={{ whiteSpace: "nowrap" }}>{formatRON(st.subtotal)}</td>
                          <td className="muted" style={{ whiteSpace: "nowrap", fontSize: 12.5 }}>
                            {st.deliveryFee > 0 ? (
                              <>
                                +{formatRON(st.deliveryFee)}
                                {st.needForFreeDelivery != null && st.needForFreeDelivery > 0 && (
                                  <div style={{ fontSize: 11.5 }}>gratis peste încă {formatRON(st.needForFreeDelivery)}</div>
                                )}
                              </>
                            ) : st.storeType === "physical" ? "—" : "gratis"}
                          </td>
                          <td style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{formatRON(st.total)}</td>
                          <td className="muted">{st.itemsFound}/{result.itemCount}{st.missing > 0 ? ` (lipsesc ${st.missing})` : ""}</td>
                          {/* The coverage number says what is missing; this says what to do
                              about it. Every row gets the link, not only incomplete ones — a
                              complete basket at one shop is exactly when you want to go there. */}
                          <td>
                            <Link className="btn btn-outline btn-sm" href={`/lista/magazin/${st.slug}`}>
                              {st.missing > 0 ? `Completează coșul la ${st.name}` : `Vezi coșul la ${st.name}`}
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
