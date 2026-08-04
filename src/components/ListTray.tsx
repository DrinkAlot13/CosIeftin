"use client";

import { useEffect, useState } from "react";

const KEY = "cosmic_list";

function count(): number {
  try {
    return (JSON.parse(localStorage.getItem(KEY) || "[]") as unknown[]).length;
  } catch {
    return 0;
  }
}

export function ListTray() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const sync = () => setN(count());
    sync();
    window.addEventListener("cosmic-list", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("cosmic-list", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  if (n === 0) return null;
  return (
    <a className="list-tray" href="/lista">
      🛒 Lista mea ({n}) →
    </a>
  );
}
