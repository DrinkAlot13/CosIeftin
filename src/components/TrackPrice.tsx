"use client";

import { useEffect, useState } from "react";
import { addAlert, ALERT_EVENT, isTracked, removeAlert } from "@/lib/alerts";

/** Toggle a price tracker for a product. `price` = current lowest (the baseline). */
export function TrackPrice({ slug, name, price }: { slug: string; name: string; price: number }) {
  const [tracked, setTracked] = useState(false);
  useEffect(() => {
    const sync = () => setTracked(isTracked(slug));
    sync();
    window.addEventListener(ALERT_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(ALERT_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [slug]);

  function toggle() {
    if (isTracked(slug)) removeAlert(slug);
    else addAlert({ slug, name, target: null, base: price });
  }

  return (
    <button type="button" className={tracked ? "btn btn-accent" : "btn btn-outline"} onClick={toggle} title="Primești o alertă când prețul scade">
      {tracked ? "🔔 Urmărit" : "🔔 Urmărește prețul"}
    </button>
  );
}
