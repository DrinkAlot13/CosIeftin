// Favourites, grouped by category.
//
// Two kinds of row, kept visually distinct because they mean different things:
//   ♥ EXPLICIT  — the shopper pressed the heart. A statement.
//   ♡ INFERRED  — added to a list three or more times. Evidence, and the page says how much:
//                 "l-ai adăugat de 4 ori". An inferred favourite the shopper disagrees with is
//                 one tap from being removed, and the reason is on screen so they can judge it.

import Link from "next/link";
import { FavoriteHeart } from "@/components/FavoriteHeart";
import { getCurrentUser } from "@/lib/auth";
import { INFERRED_AFTER_ADDS, listFavourites, type FavouriteRow } from "@/lib/favourites";

export const dynamic = "force-dynamic";
export const metadata = { title: "Favoritele mele" };

export default async function FavoritePage() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <div className="container">
        <div className="section"><h1 style={{ fontSize: 26 }}>♥ Favoritele mele</h1></div>
        <div className="empty">
          <p>Intră în cont ca să îți salvezi produsele favorite.</p>
          <Link className="btn btn-primary" href="/login?next=/favorite">Intră în cont</Link>
        </div>
      </div>
    );
  }

  const rows = await listFavourites(user.id);
  const byCategory = new Map<string, FavouriteRow[]>();
  for (const r of rows) {
    const list = byCategory.get(r.categoryName) ?? [];
    list.push(r);
    byCategory.set(r.categoryName, list);
  }
  const groups = [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length);
  const explicit = rows.filter((r) => r.source === "EXPLICIT").length;
  const inferred = rows.length - explicit;

  return (
    <div className="container" style={{ paddingBottom: 40 }}>
      <nav className="breadcrumb" aria-label="breadcrumb">
        <Link href="/">Acasă</Link>
        <span className="sep">/</span>
        <span>Favorite</span>
      </nav>
      <div className="section-head" style={{ marginTop: 8 }}>
        <h1 style={{ fontSize: 26 }}>♥ Favoritele mele</h1>
      </div>
      <p className="muted" style={{ marginTop: -4, maxWidth: 640, lineHeight: 1.6 }}>
        {rows.length === 0
          ? "Nu ai încă favorite."
          : <>{explicit} alese de tine{inferred > 0 && <> · {inferred} adăugate automat</>}.</>}{" "}
        Când construim coșul, produsele de aici au prioritate față de o alternativă mai ieftină —
        alegem în locul tău doar ce nu ai spus deja.
      </p>

      {rows.length === 0 ? (
        <div className="empty">
          <p>Apasă ♡ pe orice produs ca să îl salvezi aici.</p>
          <p className="muted" style={{ fontSize: 13.5 }}>
            Un produs pe care îl adaugi în listă de {INFERRED_AFTER_ADDS} ori apare aici automat.
          </p>
          <Link className="btn btn-primary" href="/">Vezi produse</Link>
        </div>
      ) : (
        groups.map(([category, items]) => (
          <section key={category} style={{ marginTop: 26 }}>
            <div className="section-head">
              <h2 style={{ margin: 0, fontSize: 18 }}>
                {category} <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>({items.length})</span>
              </h2>
            </div>
            <div className="card" style={{ overflowX: "auto" }}>
              <table className="admin-table">
                <thead>
                  <tr><th style={{ width: 44 }}></th><th>Produs</th><th>De ce e aici</th><th style={{ width: 60 }}></th></tr>
                </thead>
                <tbody>
                  {items.map((r) => (
                    <tr key={r.productId}>
                      <td><FavoriteHeart productId={r.productId} size={20} /></td>
                      <td>
                        <Link href={`/p/${r.slug}`} style={{ fontWeight: 600 }}>{r.name}</Link>
                        {r.brand && <div className="muted" style={{ fontSize: 12 }}>{r.brand}</div>}
                        {/* Same >2% floor as the deals page — a 0.4% wobble is noise, not news. */}
                        {r.dropPct != null && r.dropPct > 2 && (
                          <div style={{ fontSize: 12, color: "var(--primary)", fontWeight: 600, marginTop: 2 }}>
                            📉 -{r.dropPct.toFixed(0)}% față de vârful recent
                          </div>
                        )}
                      </td>
                      <td className="muted" style={{ fontSize: 13 }}>
                        {r.source === "EXPLICIT"
                          ? "L-ai marcat cu ♥"
                          : `L-ai adăugat în listă de ${r.addCount} ori`}
                      </td>
                      <td>
                        <Link href={`/p/${r.slug}`} className="muted" style={{ fontSize: 13 }}>vezi →</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </div>
  );
}
