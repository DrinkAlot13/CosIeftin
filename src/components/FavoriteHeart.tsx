"use client";
// The heart. On every product card and every item page.
//
// It reads the signed-in user's favourites once per page through a tiny shared cache rather
// than one request per card: a listing renders 48 cards, and 48 identical GETs to say the same
// thing is a self-inflicted load problem.
//
// An anonymous visitor sees the heart and, on click, is told to sign in. The alternative —
// hiding it — makes the feature invisible to exactly the people who have not adopted it yet.

import { useEffect, useState } from "react";

type FavState = { signedIn: boolean; favourites: Set<number>; inferred: Set<number> };

let cache: Promise<FavState> | null = null;
const listeners = new Set<() => void>();

function loadFavourites(): Promise<FavState> {
  if (!cache) {
    cache = fetch("/api/favorites")
      .then((r) => r.json())
      .then((j: { signedIn?: boolean; favourites?: number[]; inferred?: number[] }) => ({
        signedIn: Boolean(j.signedIn),
        favourites: new Set(j.favourites ?? []),
        inferred: new Set(j.inferred ?? []),
      }))
      .catch(() => ({ signedIn: false, favourites: new Set<number>(), inferred: new Set<number>() }));
  }
  return cache;
}

/** Invalidate after a write so every heart on the page agrees. */
function refresh() {
  cache = null;
  void loadFavourites().then(() => listeners.forEach((fn) => fn()));
}

export function FavoriteHeart({ productId, size = 20 }: { productId: number; size?: number }) {
  const [state, setState] = useState<{ on: boolean; inferred: boolean; signedIn: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const sync = () => {
      void loadFavourites().then((f) => {
        if (alive) setState({ on: f.favourites.has(productId), inferred: f.inferred.has(productId), signedIn: f.signedIn });
      });
    };
    sync();
    listeners.add(sync);
    return () => { alive = false; listeners.delete(sync); };
  }, [productId]);

  async function toggle(e: React.MouseEvent) {
    // Hearts sit inside card links; without this the click navigates away mid-request.
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/favorites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productId }),
      });
      if (r.status === 401) {
        setNote("Intră în cont ca să salvezi favorite");
        setTimeout(() => setNote(null), 2600);
        return;
      }
      refresh();
    } finally {
      setBusy(false);
    }
  }

  const on = state?.on ?? false;
  const inferred = state?.inferred ?? false;
  const label = on
    ? "Scoate de la favorite"
    : inferred
      ? "Favorit automat — apasă ca să îl fixezi"
      : "Adaugă la favorite";

  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        className={`heart${on ? " on" : inferred ? " inferred" : ""}`}
        onClick={toggle}
        aria-pressed={on}
        aria-label={label}
        title={label}
        disabled={busy}
        style={{ fontSize: size }}
      >
        {on ? "♥" : "♡"}
      </button>
      {note && <span className="heart-note">{note}</span>}
    </span>
  );
}
