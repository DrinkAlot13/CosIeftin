"use client";
// This month's running total of what comparing was worth — see lib/savings.ts for what the
// number actually means (a snapshot recorded at add-time, never recomputed from today's prices).
import { useEffect, useState } from "react";

export function SavingsCounter() {
  const [bani, setBani] = useState<number | null>(null);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    fetch("/api/savings/summary")
      .then((r) => r.json())
      .then((j: { signedIn: boolean; monthBani: number }) => setBani(j.signedIn ? j.monthBani : null))
      .catch(() => setBani(null));
  }, []);

  if (bani === null || bani <= 0) return null;

  const lei = (bani / 100).toFixed(2);
  const shareText = `Am economisit ${lei} lei luna asta comparând prețurile pe CosIeftin!`;
  const cardUrl = `/api/savings/card?bani=${bani}`;

  async function share() {
    setSharing(true);
    try {
      // Share the IMAGE when the browser supports sharing files (Web Share API Level 2) — a
      // picture of the number travels better on social/chat apps than plain text does. Falls
      // back to a plain text+link share, then to clipboard, so every browser gets SOMETHING.
      const res = await fetch(cardUrl);
      const blob = await res.blob();
      const file = new File([blob], "cosieftin-economii.png", { type: "image/png" });
      const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };
      if (nav.share && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: "CosIeftin", text: shareText });
      } else if (nav.share) {
        await nav.share({ title: "CosIeftin", text: shareText, url: window.location.origin });
      } else {
        await navigator.clipboard.writeText(`${shareText} ${window.location.origin}`);
        alert("Text copiat în clipboard!");
      }
    } catch {
      // A cancelled share (user closed the sheet) also lands here — not an error worth showing.
    } finally {
      setSharing(false);
    }
  }

  return (
    <div className="pill-note" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <span>Ai economisit luna asta comparând prețurile:</span>
      <b style={{ fontSize: 18, color: "var(--accent)" }}>{lei} lei</b>
      <button type="button" className="btn btn-outline" style={{ padding: "4px 10px", fontSize: 13 }} onClick={share} disabled={sharing}>
        {sharing ? "…" : "📤 Distribuie"}
      </button>
    </div>
  );
}
