"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { type Alert, ALERT_EVENT, getAlerts, isFired } from "@/lib/alerts";

/** Header bell: shows how many tracked products are currently at a good price. */
export function AlertsBell() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [fired, setFired] = useState(0);

  useEffect(() => {
    const sync = () => setAlerts(getAlerts());
    sync();
    window.addEventListener(ALERT_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(ALERT_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const slugKey = useMemo(() => alerts.map((a) => a.slug).sort().join("|"), [alerts]);
  useEffect(() => {
    if (alerts.length === 0) {
      setFired(0);
      return;
    }
    let cancelled = false;
    fetch("/api/basket", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: alerts.map((a) => ({ slug: a.slug, qty: 1 })) }),
    })
      .then((r) => r.json())
      .then((d: { perItem?: { slug: string; cheapest: { linePrice: number } | null }[] }) => {
        if (cancelled) return;
        const price: Record<string, number> = {};
        for (const pi of d.perItem ?? []) if (pi.cheapest) price[pi.slug] = pi.cheapest.linePrice;
        setFired(alerts.filter((a) => isFired(a, price[a.slug])).length);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slugKey]);

  return (
    <Link href="/alerte" className="header-list-link" title="Alertele mele de preț" style={{ position: "relative" }}>
      🔔{fired > 0 && <span className="bell-badge" style={{ background: "#0a8a3f", color: "#fff", borderRadius: 10, padding: "0 6px", fontSize: 12, marginLeft: 4 }}>{fired}</span>}
    </Link>
  );
}
