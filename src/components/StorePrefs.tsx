"use client";

import { useEffect, useState } from "react";
import { getPreferred, PREF_EVENT, togglePreferred } from "@/lib/stores-pref";

type Store = { slug: string; name: string; color: string | null };

/** "My stores" picker — the chains near the user; the basket highlights their totals. */
export function StorePrefs({ stores }: { stores: Store[] }) {
  const [pref, setPref] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

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

  return (
    <div className="card" style={{ padding: "12px 14px", marginBottom: 14 }}>
      <button type="button" className="linklike" onClick={() => setOpen((o) => !o)} style={{ fontWeight: 600 }}>
        📍 Magazinele mele {pref.length > 0 ? `(${pref.length})` : ""} {open ? "▲" : "▼"}
      </button>
      {pref.length > 0 && !open && (
        <span className="muted" style={{ marginLeft: 8 }}>
          {stores.filter((s) => pref.includes(s.slug)).map((s) => s.name).join(", ")}
        </span>
      )}
      {open && (
        <div style={{ marginTop: 10 }}>
          <p className="muted" style={{ marginTop: 0 }}>Alege lanțurile din apropierea ta — le evidențiem în comparație.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {stores.map((s) => {
              const on = pref.includes(s.slug);
              return (
                <button
                  key={s.slug}
                  type="button"
                  onClick={() => togglePreferred(s.slug)}
                  className={on ? "chip active" : "chip"}
                  style={on && s.color ? { borderColor: s.color } : undefined}
                >
                  {on ? "✓ " : ""}{s.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
