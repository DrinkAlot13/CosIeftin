// Indexul CoșMic — what a basket of 40 everyday needs costs, and how that moves.
//
// ── WHAT CHANGED, AND WHY IT HAD TO.
//
// v1 pinned forty specific products by slug. That was the right answer to the bug it was built
// against: before it, the basket was resolved at request time by substring search, priced coffee
// creamer as coffee, and read +26,8% in three days by changing its own membership.
//
// But pinning made the per-shop table useless. No merchant carries all forty pinned products —
// Auchan best at 33/40, Kaufland at 3/40 — so "cât costă coșul la fiecare magazin" rendered as a
// column of dashes. That is the question a shopper opens this page to answer.
//
// v2 defines each line as an EQUIVALENCE CLASS, so each shop prices the line with its own
// equivalent. What keeps that honest is in lib/index-basket-v2: a size window on every class, an
// audit that reports what each class actually resolved to, and a per-shop column that never
// borrows from another shop.
//
// ── AND THE TWO VERSIONS ARE NOT COMPARABLE. The page says so, the chart breaks, and the
//    methodology page repeats it. If we change the list, we change the version.

import { Fragment } from "react";
import Link from "next/link";
import { VersionedBasketChart } from "@/components/VersionedBasketChart";
import { formatRON } from "@/lib/format";
import { BASKET_V2_GROUPS, BASKET_V2_VERSION, INDEX_BASKET_V2 } from "@/lib/index-basket-v2";
import { priceBasketV2 } from "@/lib/index-v2";
import { versionedSeries, changeWithin } from "@/lib/index-series-v2";

export const revalidate = 3600;

export const metadata = {
  title: "Indexul CoșMic — cât costă un coș de 40 de produse de bază",
  description:
    "Un coș de 40 de nevoi de bază, evaluat la fiecare magazin cu echivalentul lui. Nu este o cifră oficială de inflație.",
};

const pct = (n: number): string => `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
const lei = (bani: number): string => formatRON(bani / 100);

export default async function IndexPage() {
  const [now, series] = await Promise.all([priceBasketV2(), versionedSeries()]);
  const month = changeWithin(series.v2, 28);
  const pricedShops = now.shops.filter((s) => s.found > 0);
  const bestFilled = now.bestAnywhereLines.filter((l) => l.priceBani != null).length;

  // The most complete shop, and the cheapest AMONG SHOPS THAT FILLED THE SAME NUMBER OF LINES.
  // Ranking a 14-line basket against a 28-line one is the composition error this page exists to
  // avoid, one level down from the version boundary.
  const maxFilled = pricedShops.length ? Math.max(...pricedShops.map((s) => s.found)) : 0;
  const comparable = pricedShops.filter((s) => s.found === maxFilled);
  const cheapestComparable = [...comparable].sort((a, b) => a.totalBani - b.totalBani)[0] ?? null;

  return (
    <div className="container" style={{ paddingBottom: 60 }}>
      <div className="section" style={{ paddingBottom: 0 }}>
        <h1 style={{ fontSize: 28, marginBottom: 4 }}>Indexul CoșMic — cât costă coșul</h1>
        <p className="muted" style={{ maxWidth: 720 }}>
          40 de nevoi de bază — lapte, ouă, pâine, ulei, detergent — evaluate la fiecare magazin
          cu <b>echivalentul lui</b>. Nu este o cifră oficială de inflație și nu încearcă să fie.
        </p>
        <p className="pill-note" style={{ marginTop: 10 }}>
          <b>Coș versiunea {BASKET_V2_VERSION}.</b> Până pe {series.boundary.lastV1 ?? "—"} coșul era
          definit ca 40 de <i>produse fixate</i>; de pe {series.boundary.firstV2 ?? "—"} este definit ca
          40 de <i>clase de echivalență</i>. Sunt două coșuri diferite și <b>totalurile lor nu se
          compară între ele</b>. Istoricul v1 rămâne stocat și nu a fost recalculat.
        </p>
      </div>

      {/* ── The headline, and the thing it is NOT. */}
      <div className="section" style={{ paddingTop: 18 }}>
        <div className="idx-head">
          <div>
            <div className="muted" style={{ fontSize: 13 }}>cel mai mic preț per produs, de oriunde</div>
            <div style={{ fontSize: 40, fontWeight: 800, lineHeight: 1.1 }}>{lei(now.bestAnywhereBani)}</div>
            <div className="muted" style={{ fontSize: 13 }}>
              {bestFilled}/{INDEX_BASKET_V2.length} linii · cumpărând fiecare produs de unde e cel mai ieftin
            </div>
          </div>
          {cheapestComparable && (
            <div>
              <div className="muted" style={{ fontSize: 13 }}>cel mai ieftin într-un singur magazin</div>
              <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.2 }}>
                {lei(cheapestComparable.totalBani)} <span className="muted" style={{ fontSize: 15, fontWeight: 600 }}>· {cheapestComparable.merchantName}</span>
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                {cheapestComparable.found}/{INDEX_BASKET_V2.length} linii — comparat doar cu magazinele
                care au acoperit tot atâtea
              </div>
            </div>
          )}
          {month && (
            <div>
              <div className="muted" style={{ fontSize: 13 }}>față de acum ~o lună</div>
              <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.2 }}>{pct(month.pct)}</div>
              <div className="muted" style={{ fontSize: 13 }}>{month.from} → {month.to}</div>
            </div>
          )}
        </div>
      </div>

      {/* ── Gaps, stated before the numbers are admired. */}
      {(now.unfillable.length > 0 || now.missingClasses.length > 0) && (
        <div className="section" style={{ paddingTop: 0 }}>
          <div className="pill-note pill-warn">
            <b>{now.unfillable.length} din {INDEX_BASKET_V2.length} linii nu pot fi acoperite de niciun magazin
            urmărit:</b>{" "}
            {now.unfillable.map((u) => u.label).join(", ")}. Sunt goluri în catalogul nostru, nu în
            magazine — le arătăm ca să se vadă cât din coș chiar putem evalua.
            {now.missingClasses.length > 0 && (
              <> Clase lipsă din definiție: {now.missingClasses.join(", ")}.</>
            )}
          </div>
        </div>
      )}

      <h2 style={{ fontSize: 20, marginTop: 24 }}>Cum a evoluat coșul</h2>
      <p className="muted" style={{ maxWidth: 720, marginTop: -4, fontSize: 14 }}>
        Linia gri este coșul v1 (produse fixate), linia albastră este v2 (clase). Sunt măsurători
        diferite: linia se rupe la schimbare pentru că un salt acolo este o schimbare de
        definiție, nu de preț.
      </p>
      <VersionedBasketChart v1={series.v1} v2={series.v2} />

      {/* ── The table this whole change exists for. */}
      <h2 style={{ fontSize: 20, marginTop: 30 }}>Cât costă coșul la fiecare magazin</h2>
      <p className="muted" style={{ maxWidth: 760, marginTop: -4, fontSize: 14 }}>
        Fiecare linie e evaluată <b>doar cu produsele acelui magazin</b>. Nu împrumutăm produsul
        din altă parte ca să umplem un gol — un coș căruia îi lipsesc linii este arătat ca atare,
        iar totalurile a două magazine care au acoperit un număr diferit de linii nu se compară.
      </p>
      <div className="idx-shops">
        {pricedShops.map((s) => {
          const filled = s.lines.filter((l) => l.priceBani != null);
          const missing = s.lines.filter((l) => l.priceBani == null);
          return (
            <details key={s.merchantSlug} className="card idx-shop">
              <summary>
                <span className="idx-shop__name">{s.merchantName}</span>
                <span className="idx-shop__total">{lei(s.totalBani)}</span>
                <span className={`idx-shop__cov${s.found === maxFilled ? " is-best" : ""}`}>
                  {s.found}/{s.lines.length} linii
                </span>
              </summary>
              <table className="ms-table">
                <thead>
                  <tr><th>linie</th><th>produsul ales de noi</th><th className="num">preț</th></tr>
                </thead>
                <tbody>
                  {filled.map((l) => (
                    <tr key={l.item.key}>
                      <td>{l.item.label}</td>
                      <td>
                        {l.productSlug ? <Link href={`/p/${l.productSlug}`}>{l.productName}</Link> : l.productName}
                        {l.pricedPerUnit && <span className="muted"> · preț la {l.item.label.includes("kg") ? "kg" : "unitate"}</span>}
                        {l.alternatives > 0 && <span className="muted"> · din {l.alternatives + 1} variante</span>}
                      </td>
                      <td className="num">{lei(l.priceBani ?? 0)}</td>
                    </tr>
                  ))}
                  {missing.length > 0 && (
                    <tr>
                      <td colSpan={3} className="muted" style={{ fontSize: 13 }}>
                        Lipsesc {missing.length}: {missing.map((m) => m.item.label).join(", ")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </details>
          );
        })}
      </div>

      {/* ── What is in the basket. */}
      <h2 style={{ fontSize: 20, marginTop: 32 }}>Ce este în coș</h2>
      <p className="muted" style={{ maxWidth: 720, marginTop: -4, fontSize: 14 }}>
        Fiecare linie este o <b>clasă</b>, nu un produs anume: „lapte integral, 1 l” înseamnă
        laptele integral de un litru al fiecărui magazin. Fiecare clasă are o fereastră de mărime,
        ca să nu ajungă o sticlă de 200 ml să treacă drept litru.
      </p>
      <div className="idx-groups">
        {BASKET_V2_GROUPS.map((g) => (
          <Fragment key={g}>
            <h3 style={{ fontSize: 15, marginTop: 16, marginBottom: 6 }}>{g}</h3>
            <ul className="idx-list">
              {INDEX_BASKET_V2.filter((i) => i.group === g).map((i) => {
                const best = now.bestAnywhereLines.find((b) => b.item.key === i.key);
                return (
                  <li key={i.key}>
                    <span>{i.label}</span>
                    <span className="muted">
                      {best?.priceBani != null
                        ? `${lei(best.priceBani)} · ${best.merchantSlug}`
                        : "niciun magazin"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Fragment>
        ))}
      </div>

      <h2 style={{ fontSize: 20, marginTop: 32 }}>Ce măsoară și ce nu măsoară</h2>
      <ul className="muted" style={{ maxWidth: 760, lineHeight: 1.65 }}>
        <li>
          <b>Nu este inflația.</b> INS măsoară mii de produse și servicii cu ponderi de consum. Noi
          măsurăm 40 de nevoi de bază la magazinele pe care le urmărim.
        </li>
        <li>
          <b>Un total per magazin este valabil doar pentru liniile pe care le-a acoperit.</b> Un
          magazin cu 14 linii nu este „mai ieftin” decât unul cu 28 — este mai gol.
        </li>
        <li>
          <b>Clasele pot alege alt produs de la o zi la alta</b> — asta e ideea, dar și riscul.
          Rulăm <code>audit:basket-classes</code> ca să vedem ce a ales fiecare clasă la fiecare
          magazin, și marcăm orice clasă ale cărei mărimi nu se potrivesc între ele.
        </li>
        <li>
          <b>Prețurile de pe platformele de livrare sunt excluse</b> — au adaos și nu sunt prețul
          de raft.
        </li>
        <li>
          Detalii complete pe <Link href="/metodologie">pagina de metodologie</Link>.
        </li>
      </ul>
    </div>
  );
}
