"use client";

import { useEffect, useState } from "react";

type Theme = "system" | "light" | "dark";
const ORDER: Theme[] = ["system", "light", "dark"];
const ICONS: Record<Theme, string> = { system: "🖥️", light: "☀️", dark: "🌙" };
const LABELS: Record<Theme, string> = { system: "sistem", light: "luminos", dark: "întunecat" };

function apply(t: Theme) {
  if (t === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => {
    try {
      const s = localStorage.getItem("pm_theme") as Theme | null;
      if (s) setTheme(s);
    } catch {
      /* ignore */
    }
  }, []);

  const cycle = () => {
    const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
    setTheme(next);
    try {
      localStorage.setItem("pm_theme", next);
    } catch {
      /* ignore */
    }
    apply(next);
  };

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={cycle}
      aria-label={`Temă: ${LABELS[theme]}`}
      title={`Temă: ${LABELS[theme]} (apasă pentru a schimba)`}
    >
      {ICONS[theme]}
    </button>
  );
}
