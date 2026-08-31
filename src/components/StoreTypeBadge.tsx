const LABELS: Record<string, { icon: string; label: string; title: string }> = {
  online: { icon: "🌐", label: "Online", title: "Doar online — comanzi pe site cu livrare (ex. Freshful)" },
  hybrid: { icon: "🏬", label: "Magazin + online", title: "Îl găsești în magazin fizic și îl poți comanda online" },
  physical: { icon: "🏪", label: "În magazin", title: "Doar în magazin fizic" },
};

/** Small indicator of how a store can be bought from. */
export function StoreTypeBadge({ type }: { type?: string | null }) {
  const t = LABELS[type ?? "hybrid"] ?? LABELS.hybrid;
  return (
    <span className="badge" title={t.title} style={{ whiteSpace: "nowrap" }}>
      {t.icon} {t.label}
    </span>
  );
}
