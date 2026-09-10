"use client";
// ── THE SCREEN A PERSON USES WHILE STANDING IN AN AISLE.
//
// Everything here follows from where it is used: one hand, portrait, 390px, a phone held at
// arm's length under supermarket lighting, and frequently with no signal at all.
//
//   · GROUPED BY SHOP, because a person is in ONE shop. Someone in Auchan scrolling past
//     Kaufland lines is reading a list that is mostly not for them.
//   · TAP TARGETS AT 56px, above the 44px both platforms recommend, because the alternative is
//     a mis-tap while pushing a trolley.
//   · TICKING IS LOCAL AND SYNCHRONOUS. No request, no spinner, no failure state — see
//     lib/shop-mode.ts for why there is nothing to sync to.
//   · EVERY PRICE SAYS WHEN IT WAS CHECKED. A price from six days ago must not look like a
//     price from this morning, and in a shop that difference is the whole point.
//
// It reads the SAME cached basket `ListBuilder` writes, so opening this with the radio off
// shows the last computed answer with its age, rather than an empty panel.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatRON } from "@/lib/format";
import { describeAge, loadBasket, type Freshness } from "@/lib/offline-cache";
import { getTicked, toggleTick, clearTicks, TICK_EVENT, type TickState } from "@/lib/shop-mode";
import { getActive, CART_EVENT } from "@/lib/carts";

type Cheapest = { merchantId: number; merchantName: string; merchantSlug: string; linePrice: number; loyalty: boolean } | null;
type PerItem = { slug: string; name: string; qty: number; cheapest: Cheapest };
type StoreTotal = { slug: string; name: string; total: number; itemsFound: number };
type Result = { perItem: PerItem[]; storeTotals: StoreTotal[]; splitTotal: number };

export function ShopMode() {
  // The SAME key `ListBuilder` computes, derived the same way from the same active cart — not
  // passed in from the server, because the cart lives in the browser and the server has never
  // seen it. A second spelling of this key would read another list's totals, which is the one
  // thing `offline-cache` refuses to allow.
  const [itemsKey, setItemsKey] = useState("");
  const [state, setState] = useState<{ result: Result; freshness: Freshness } | null | undefined>(undefined);
  const [ticked, setTicked] = useState<TickState>({});
  const [shop, setShop] = useState<string | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const readCart = () => {
      const c = getActive();
      setItemsKey(c.items.map((i) => `${i.slug}:${i.qty}`).join("|"));
    };
    readCart();
    window.addEventListener(CART_EVENT, readCart);
    return () => window.removeEventListener(CART_EVENT, readCart);
  }, []);

  useEffect(() => {
    if (!itemsKey) { setState(null); return; }
    // `undefined` = not read yet, `null` = read and empty. Rendering "lista e goală" during the
    // first frame of a full list is the same defect the wallet had, and the image placeholder
    // before it: an initial value doubling as an answer.
    setState(loadBasket<Result>(itemsKey) ?? null);
    const sync = () => setTicked(getTicked());
    sync();
    const net = () => setOnline(navigator.onLine);
    net();
    window.addEventListener(TICK_EVENT, sync);
    window.addEventListener("storage", sync);
    window.addEventListener("online", net);
    window.addEventListener("offline", net);
    return () => {
      window.removeEventListener(TICK_EVENT, sync);
      window.removeEventListener("storage", sync);
      window.removeEventListener("online", net);
      window.removeEventListener("offline", net);
    };
  }, [itemsKey]);

  const byShop = useMemo(() => {
    const m = new Map<string, { name: string; items: PerItem[] }>();
    for (const it of state?.result.perItem ?? []) {
      const key = it.cheapest?.merchantSlug ?? "__fara__";
      const name = it.cheapest?.merchantName ?? "Fără preț";
      if (!m.has(key)) m.set(key, { name, items: [] });
      m.get(key)!.items.push(it);
    }
    return [...m.entries()].sort((a, b) => b[1].items.length - a[1].items.length);
  }, [state]);

  useEffect(() => {
    if (shop === null && byShop.length > 0) setShop(byShop[0][0]);
  }, [byShop, shop]);

  if (state === undefined) return null;
  if (state === null) {
    return (
      <div className="empty">
        <p>Nu am un coș calculat pentru lista asta.</p>
        <p className="muted" style={{ fontSize: 13 }}>
          Deschide lista cât ai semnal, ca să avem ce îți arăta în magazin.
        </p>
        <Link className="btn btn-primary" href="/lista">Înapoi la listă</Link>
      </div>
    );
  }

  const current = byShop.find(([k]) => k === shop);
  const items = current?.[1].items ?? [];
  const doneCount = items.filter((i) => ticked[i.slug] !== undefined).length;
  const takenTotal = items
    .filter((i) => ticked[i.slug] !== undefined)
    .reduce((sum, i) => sum + (i.cheapest?.linePrice ?? 0), 0);
  const shopTotal = items.reduce((sum, i) => sum + (i.cheapest?.linePrice ?? 0), 0);

  return (
    <div className="shopmode">
      {/* ── HOW OLD THESE PRICES ARE, always, not only when offline. A price checked this
          morning and one checked six days ago look identical without it, and the shopper is
          standing in front of the shelf that settles it. */}
      <div className={`shopmode-age ${state.freshness.ageMs > 6 * 3600_000 ? "is-old" : ""}`}>
        {online ? "🛒" : "📴"} Prețuri verificate <b>{state.freshness.label}</b>
        {!online && " · ești offline"}
      </div>

      {/* ── ONE SHOP AT A TIME. A person is in one shop; the others are noise. */}
      {byShop.length > 1 && (
        <div className="shopmode-tabs" role="tablist" aria-label="Magazin">
          {byShop.map(([slug, s]) => (
            <button
              key={slug}
              role="tab"
              aria-selected={slug === shop}
              className={`shopmode-tab ${slug === shop ? "is-on" : ""}`}
              onClick={() => setShop(slug)}
            >
              {s.name}
              <span className="shopmode-tab-n">{s.items.length}</span>
            </button>
          ))}
        </div>
      )}

      <ul className="shopmode-list">
        {items.map((it) => {
          const on = ticked[it.slug] !== undefined;
          return (
            <li key={it.slug}>
              {/* The whole row is the target, not a small checkbox — one hand, moving trolley. */}
              <button
                type="button"
                className={`shopmode-row ${on ? "is-done" : ""}`}
                aria-pressed={on}
                onClick={() => toggleTick(it.slug)}
              >
                <span className="shopmode-check" aria-hidden>{on ? "✓" : ""}</span>
                <span className="shopmode-name">
                  {it.name}
                  {it.qty > 1 && <span className="shopmode-qty"> ×{it.qty}</span>}
                  {it.cheapest?.loyalty && <span className="shopmode-card">💳 cu card</span>}
                </span>
                <span className="shopmode-price">
                  {it.cheapest ? formatRON(it.cheapest.linePrice) : "—"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {items.length === 0 && <div className="empty">Nimic de luat din magazinul ăsta.</div>}

      {/* ── THE RUNNING TOTAL, fixed to the bottom where a thumb reaches. It counts what is IN
          THE TROLLEY, not what the list costs — those are different numbers and the one that
          matters at the till is the first. */}
      <div className="shopmode-bar">
        <div>
          <div className="shopmode-bar-n">{doneCount} din {items.length} luate</div>
          <div className="shopmode-bar-sub">din {formatRON(shopTotal)} pe listă</div>
        </div>
        <div className="shopmode-bar-total">{formatRON(takenTotal)}</div>
      </div>

      <div className="shopmode-foot">
        <button type="button" className="linklike" onClick={() => { clearTicks(); }}>
          Golește bifele
        </button>
        <Link href="/lista">Înapoi la listă</Link>
      </div>
    </div>
  );
}
