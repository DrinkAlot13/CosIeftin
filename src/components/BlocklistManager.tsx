"use client";
// The write path for UserBlocklist — a brand you never want suggested, or a word you never want
// to see in a product's name. The model and its read-side enforcement (resolve.ts's isBuyable)
// already existed; there was simply no way to add an entry except directly in the database.
//
// `attributeTag` is a plain substring match against a product's name, stated as such in the UI —
// never implied to be a verified allergen check, because a wrong claim there is a safety issue,
// not a UX one.
import { useEffect, useState } from "react";

type Item = { id: number; brand: string | null; attributeTag: string | null; productId: number | null };

export function BlocklistManager() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [brand, setBrand] = useState("");
  const [tag, setTag] = useState("");

  function load() {
    fetch("/api/blocklist")
      .then((r) => r.json())
      .then((j: { items?: Item[] }) => setItems(j.items ?? []))
      .catch(() => setItems([]));
  }
  useEffect(load, []);

  async function add(kind: "brand" | "attributeTag", value: string) {
    if (!value.trim()) return;
    await fetch("/api/blocklist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ [kind]: value.trim() }),
    });
    if (kind === "brand") setBrand(""); else setTag("");
    load();
  }
  async function remove(id: number) {
    await fetch(`/api/blocklist?id=${id}`, { method: "DELETE" });
    load();
  }

  if (items === null) return null;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <input aria-label="Brand de evitat" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Un brand de evitat (ex. Nestle)" style={{ flex: 1, minWidth: 180 }} />
        <button type="button" className="btn btn-outline btn-sm" onClick={() => add("brand", brand)}>Adaugă brand</button>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <input aria-label="Cuvânt de evitat în denumire" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Un cuvânt de evitat în denumire (ex. gluten)" style={{ flex: 1, minWidth: 180 }} />
        <button type="button" className="btn btn-outline btn-sm" onClick={() => add("attributeTag", tag)}>Adaugă cuvânt</button>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: -4, marginBottom: 10 }}>
        Caută cuvântul în denumirea produsului — nu e o verificare de alergeni. Nu te baza pe asta
        pentru siguranță alimentară; verifică mereu eticheta.
      </p>
      {items.length === 0 ? (
        <div className="muted" style={{ fontSize: 13 }}>Nimic blocat momentan.</div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {items.map((it) => (
            <li key={it.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <span className="badge">{it.brand ? `brand: ${it.brand}` : it.attributeTag ? `cuvânt: ${it.attributeTag}` : `produs #${it.productId}`}</span>
              <button type="button" className="linklike" onClick={() => remove(it.id)}>șterge</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
