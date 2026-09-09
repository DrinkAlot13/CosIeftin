// "Reducere reală sau reducere de vitrină?" — the badge that shows its working.
//
// Copy rule: state what the numbers show. Never assert intent, never accuse. A retailer may
// raise a price legitimately, and our own history can be incomplete.
import type { DiscountEvidence } from "@/lib/discount-verify";
import { verdictLabel, verdictExplanation } from "@/lib/discount-verify";

export function DiscountBadge({ evidence, compact = false }: { evidence: DiscountEvidence; compact?: boolean }) {
  // Nothing to say without evidence — an empty badge is better than a hedged one.
  if (evidence.verdict === "NECUNOSCUT") return null;
  const { label, tone } = verdictLabel(evidence.verdict, evidence.windowDays);
  const colors: Record<string, { bg: string; fg: string }> = {
    good: { bg: "rgba(31,107,74,.12)", fg: "#1f6b4a" },
    neutral: { bg: "rgba(90,97,87,.12)", fg: "#5a6157" },
    warn: { bg: "rgba(185,106,21,.14)", fg: "#8a4f10" },
  };
  const c = colors[tone];

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: 4, maxWidth: 460 }}>
      <span
        style={{
          alignSelf: "flex-start", background: c.bg, color: c.fg, fontWeight: 700,
          fontSize: 12.5, padding: "3px 10px", borderRadius: 999, whiteSpace: "nowrap",
        }}
      >
        {evidence.verdict === "REDUCERE_REALA" ? "✓ " : evidence.verdict === "FARA_REDUCERE" ? "! " : ""}
        {label}
      </span>
      {!compact && (
        <span className="muted" style={{ fontSize: 12.5, lineHeight: 1.45 }}>
          {verdictExplanation(evidence)}
        </span>
      )}
    </div>
  );
}
