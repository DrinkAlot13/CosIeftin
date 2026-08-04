"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatRON } from "@/lib/format";

type Suggestion = { slug: string; name: string; brand: string | null; lowest: number };

export function SearchAutocomplete() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Debounced fetch of suggestions.
  useEffect(() => {
    if (q.trim().length < 2) {
      setItems([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/suggest?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        const data = (await r.json()) as Suggestion[];
        setItems(data);
        setOpen(true);
      } catch {
        /* aborted */
      }
    }, 160);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  // Close on outside click.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
    setOpen(false);
  }

  return (
    <div className="search" ref={boxRef} style={{ position: "relative" }}>
      <form onSubmit={submit} role="search">
        <input
          type="search"
          name="q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => items.length > 0 && setOpen(true)}
          placeholder="Caută produse, branduri, modele…"
          aria-label="Caută produse"
          autoComplete="off"
        />
        <button type="submit">Caută</button>
      </form>
      {open && items.length > 0 && (
        <ul className="suggest">
          {items.map((it) => (
            <li key={it.slug}>
              <a href={`/p/${it.slug}`} onClick={() => setOpen(false)}>
                <span className="s-name">
                  {it.brand ? <span className="s-brand">{it.brand} </span> : null}
                  {it.name}
                </span>
                <span className="s-price">de la {formatRON(it.lowest)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
