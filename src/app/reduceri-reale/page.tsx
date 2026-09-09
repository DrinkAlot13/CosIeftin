// Public "reduceri reale" page. Shows ONLY reductions the retailer's own published 30-day
// minimum supports — never a reduction inferred from our history alone.
//
// COPY RULE, inherited from `lib/discount-verify.ts` and not negotiable here: this page states
// what the numbers show. It never says a shop lied, never implies intent, and always names
// whose number the claim rests on. A retailer may raise a price for perfectly ordinary
// reasons, and our own record can be incomplete.
//
// WHY IT ONLY EVER CITES THE RETAILER. `audit:discount-truth` reports the rate at which the
// retailer's sworn figure agrees with the floor we observed independently. Until that rate is
// high, our floor is not a thing to speak from — and today it is not: the oldest observation
// in this database is 34 days old, and Penny's own series still mixes three pricing bases.
// So the page cites their number and shows ours beside it as context, never the other way.
import Link from "next/link";
import { notFound } from "next/navigation";
import { trustFeaturesEnabled } from "@/lib/flags";
import { getDiscountRows, publishable } from "@/lib/discount-page";
import { verdictExplanation } from "@/lib/discount-verify";

// ── force-dynamic BECAUSE THE FLAG IS READ AT RUN TIME.
//
// This page's existence depends on FEATURE_TRUST, and `revalidate` made that decision at BUILD
// time: the build ran without the variable, `notFound()` fired, and the 404 was baked into the
// output. Setting FEATURE_TRUST=true on a running server then changed nothing — verified by
// starting one and fetching this path, which returned 404 with the flag on.
//
// That breaks the flag in the direction nobody checks. `lib/flags.ts` is careful that an
// ambiguous value never turns a feature ON; it says nothing about a deliberate ON silently
// doing nothing, and "publish this" requiring a rebuild is not a publishing workflow.
//
// Caching costs nothing here: both trust pages are small, rarely visited, and gated off.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Reduceri reale — CoșMic",
  description:
    "Reduceri la care prețul de acum chiar este sub minimul ultimelor 30 de zile publicat de magazin. Cu ambele cifre la vedere.",
};

const lei = (b: number) => `${(b / 100).toFixed(2).replace(".", ",")} lei`;

export default async function ReduceriRealePage() {
  // Like /shrinkflation: 404 rather than an empty page. An empty page reads as "we looked and
  // found nothing", which is a claim of its own and not the one that would be true.
  if (!trustFeaturesEnabled()) notFound();

  const rows = publishable(await getDiscountRows({ onlyRetailerBacked: true }));

  return (
    <div className="container">
      <div className="section" style={{ paddingBottom: 6 }}>
        <h1 style={{ fontSize: 28 }}>Reduceri reale</h1>
        <p className="muted" style={{ maxWidth: 660 }}>
          Un preț tăiat nu înseamnă automat că plătești mai puțin decât plăteai luna trecută.
          Magazinele sunt obligate să publice cel mai mic preț din ultimele 30 de zile, iar aici
          comparăm prețul de acum cu acea cifră — a lor, nu a noastră. Listăm doar cazurile în
          care prețul chiar coboară sub ea.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="pill-note">
          Nu avem acum nicio reducere pe care să o putem verifica astfel. Publicăm un caz doar
          când magazinul își publică singur minimul pe 30 de zile și prețul curent este sub el.
          Preferăm să nu spunem nimic decât să spunem ceva ce nu putem susține.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {rows.map((r) => (
            <div className="card" key={r.offerId} style={{ padding: 14 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "baseline", justifyContent: "space-between" }}>
                <Link href={`/p/${r.productSlug}`} style={{ fontWeight: 650, fontSize: 15.5 }}>
                  {r.productName}
                </Link>
                <span className="muted" style={{ fontSize: 13 }}>{r.merchantName}</span>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 18, marginTop: 8, alignItems: "baseline" }}>
                <span style={{ fontSize: 20, fontWeight: 700 }}>{lei(r.priceBani)}</span>
                <span className="muted" style={{ fontSize: 13 }}>
                  minim 30 de zile, după magazin: <strong>{lei(r.evidence.omnibus30dBani ?? 0)}</strong>
                </span>
                <span style={{ fontSize: 13, color: "#1f6b4a", fontWeight: 650 }}>
                  −{lei(r.evidence.realSavingBani)}
                </span>
              </div>

              {/* Which price line this is. A card price is not what everybody pays, and a page
                  that quietly showed it as "the price" would overstate the saving for anyone
                  without the card. */}
              {r.priceLine === "LOYALTY" && (
                <p className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
                  Acesta este prețul cu cardul de fidelitate. Fără card, {lei(r.shelfBani)}.
                </p>
              )}

              <p className="muted" style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.5 }}>
                {verdictExplanation(r.evidence)}
              </p>

              {r.productUrl && (
                <a className="btn" href={r.productUrl} rel="nofollow noopener" target="_blank" style={{ marginTop: 8 }}>
                  Vezi în magazin
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="section">
        <p className="muted" style={{ fontSize: 12.5, maxWidth: 660 }}>
          Cifra de referință este cea publicată de magazin, conform obligației legale de a afișa
          cel mai mic preț din ultimele 30 de zile. Noi o arătăm alături de prețul curent și nu
          o interpretăm mai departe. Dacă un magazin nu publică această cifră, produsul lui nu
          apare aici. <Link href="/metodologie">Cum lucrăm</Link>.
        </p>
      </div>
    </div>
  );
}
