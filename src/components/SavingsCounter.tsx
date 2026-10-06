"use client";
// This month's running total of what comparing was worth — see lib/savings.ts for what the
// number actually means (a snapshot recorded at add-time, never recomputed from today's prices).
import { useEffect, useState } from "react";

export function SavingsCounter() {
  const [bani, setBani] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/savings/summary")
      .then((r) => r.json())
      .then((j: { signedIn: boolean; monthBani: number }) => setBani(j.signedIn ? j.monthBani : null))
      .catch(() => setBani(null));
  }, []);

  if (bani === null) return null;

  return (
    <div className="pill-note" style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      <span>Ai economisit luna asta comparând prețurile:</span>
      <b style={{ fontSize: 18, color: "var(--accent)" }}>{(bani / 100).toFixed(2)} lei</b>
    </div>
  );
}
