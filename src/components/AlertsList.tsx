"use client";

import Link from "next/link";
import { parsePriceLei } from "@/lib/price/parsePrice";
import { useEffect, useMemo, useState } from "react";
import { type Alert, ALERT_EVENT, getAlerts, isFired, removeAlert, setTarget } from "@/lib/alerts";
import { formatRON } from "@/lib/format";

export function AlertsList() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});

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
      setPrices({});
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
        const m: Record<string, number> = {};
        for (const pi of d.perItem ?? []) if (pi.cheapest) m[pi.slug] = pi.cheapest.linePrice;
        setPrices(m);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slugKey]);

  if (alerts.length === 0) {
    return <div className="empty" style={{ padding: "40px 12px" }}>Nu urmărești niciun produs. Deschide un produs și apasă „🔔 Urmărește prețul”.</div>;
  }

  return (
    <div className="card" style={{ overflowX: "auto" }}>
      <table className="admin-table">
        <thead>
          <tr><th>Produs</th><th>Preț acum</th><th>Prag alertă</th><th>Stare</th><th></th></tr>
        </thead>
        <tbody>
          {alerts.map((a) => {
            const cur = prices[a.slug];
            const fired = isFired(a, cur);
            return (
              <tr key={a.slug} style={fired ? { background: "rgba(0,150,80,.10)" } : undefined}>
                <td style={{ fontWeight: 600 }}><Link href={`/p/${a.slug}`}>{a.name}</Link></td>
                <td style={{ whiteSpace: "nowrap", fontWeight: 700 }}>{cur != null ? formatRON(cur) : "—"}</td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    defaultValue={a.target ?? ""}
                    placeholder={`orice sub ${formatRON(a.base)}`}
                    onBlur={(e) => setTarget(a.slug, e.target.value ? parsePriceLei(e.target.value) : null)}
                    style={{ width: 110 }}
                    aria-label={`Prag pentru ${a.name}`}
                  />
                </td>
                <td>{fired ? <b style={{ color: "#0a8a3f" }}>🔔 Preț bun!</b> : <span className="muted">se urmărește</span>}</td>
                <td><button type="button" className="lr-remove" onClick={() => removeAlert(a.slug)} aria-label="Șterge">×</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
