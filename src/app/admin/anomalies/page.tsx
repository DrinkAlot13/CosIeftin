// Refused values, and what was kept instead.
//
// Every sanity gate in this codebase defers rather than discards: it keeps the previously
// trusted price and records what it refused. This page is where those refusals become a
// decision instead of a row nobody reads.
//
// The Auchan case is why it exists. Offer 1905 held 28,14 from 6 August and moved to 12,00
// on 30 August — a 57% drop, past the gate. Independently re-scraped, the real price is
// 11,69: 28,14 was the anomaly and 12,00 was the CORRECTION. A gate anchored on stored
// history is most likely to fire exactly when a wrong value is being fixed, so a human has
// to arbitrate, and to arbitrate they need the refused value, the accepted one, and the
// exact source string side by side.
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Prețuri refuzate", robots: { index: false } };

const PAGE_SIZE = 100;

const lei = (bani: number | null | undefined): string =>
  bani == null ? "—" : (bani / 100).toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function AnomaliesPage({
  searchParams,
}: {
  searchParams?: { merchant?: string; show?: string; page?: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin/anomalies");
  if (!user.isAdmin) {
    return (
      <div className="container">
        <div className="empty">
          <h1 style={{ fontSize: 24 }}>Acces restricționat</h1>
          <Link className="btn btn-primary" href="/">Înapoi acasă</Link>
        </div>
      </div>
    );
  }

  const showResolved = searchParams?.show === "all";
  const merchantSlug = searchParams?.merchant ?? "";
  const page = Math.max(1, Number(searchParams?.page ?? 1) || 1);

  const where = {
    ...(showResolved ? {} : { resolved: false }),
    ...(merchantSlug ? { merchant: { slug: merchantSlug } } : {}),
  };

  const [total, rows, merchants, byReasonRaw] = await Promise.all([
    prisma.priceAnomaly.count({ where }),
    prisma.priceAnomaly.findMany({
      where,
      orderBy: { detectedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, storeName: true, rejectedPriceBani: true, acceptedPriceBani: true,
        rawPriceText: true, reason: true, detectedAt: true, resolved: true,
        merchant: { select: { slug: true, name: true } },
        offer: { select: { id: true, productUrl: true, url: true, product: { select: { name: true, slug: true } } } },
      },
    }),
    prisma.merchant.findMany({ select: { slug: true, name: true }, orderBy: { name: "asc" } }),
    prisma.priceAnomaly.groupBy({ by: ["reason"], _count: { _all: true }, where: showResolved ? {} : { resolved: false } }),
  ]);

  // Reasons carry the offending numbers, so group them by shape rather than by exact string.
  const byShape = new Map<string, number>();
  for (const r of byReasonRaw) {
    const shape = r.reason.replace(/[\d.,]+/g, "N").slice(0, 60);
    byShape.set(shape, (byShape.get(shape) ?? 0) + r._count._all);
  }
  const shapes = [...byShape.entries()].sort((a, b) => b[1] - a[1]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const qs = (over: Record<string, string>): string => {
    const p = new URLSearchParams();
    if (merchantSlug) p.set("merchant", merchantSlug);
    if (showResolved) p.set("show", "all");
    for (const [k, v] of Object.entries(over)) { if (v) p.set(k, v); else p.delete(k); }
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  return (
    <div className="container" style={{ paddingBottom: 48 }}>
      <p style={{ marginTop: 16 }}>
        <Link href="/admin" style={{ color: "var(--primary)" }}>← Admin</Link>
      </p>
      <h1 style={{ fontSize: 26, marginBottom: 4 }}>Prețuri refuzate</h1>
      <p className="muted" style={{ marginTop: 0, maxWidth: 760, lineHeight: 1.55 }}>
        Valorile pe care un filtru de plauzibilitate le-a refuzat, împreună cu prețul păstrat în
        locul lor. Un filtru care se compară cu istoricul stocat poate refuza tocmai o
        <strong> corecție</strong>: 28,14 lei era eroarea, iar 12,00 lei era prețul corect. De
        aceea nimic nu se aruncă — se păstrează aici pentru verificare.
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "18px 0" }}>
        <Link className="btn" href={`/admin/anomalies${showResolved ? qs({ show: "" }) : qs({ show: "all" })}`}>
          {showResolved ? "Doar nerezolvate" : "Arată și rezolvate"}
        </Link>
        <Link className="btn" href={`/admin/anomalies${merchantSlug ? "" : ""}`} style={{ opacity: merchantSlug ? 1 : 0.5 }}>
          Toate magazinele
        </Link>
        {merchants.map((m) => (
          <Link
            key={m.slug}
            className="btn"
            href={`/admin/anomalies?merchant=${m.slug}${showResolved ? "&show=all" : ""}`}
            style={{ fontWeight: m.slug === merchantSlug ? 700 : 400 }}
          >
            {m.name}
          </Link>
        ))}
      </div>

      {shapes.length > 0 && (
        <div style={{ margin: "18px 0", padding: 14, border: "1px solid var(--border)", borderRadius: 10 }}>
          <h2 style={{ fontSize: 15, margin: "0 0 8px" }}>Motive</h2>
          <table style={{ width: "100%", fontSize: 13.5, borderCollapse: "collapse" }}>
            <tbody>
              {shapes.map(([shape, n]) => (
                <tr key={shape}>
                  <td style={{ padding: "3px 0", fontVariantNumeric: "tabular-nums", width: 70 }}>{n}</td>
                  <td style={{ padding: "3px 0" }} className="muted">{shape}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="muted" style={{ fontSize: 13.5 }}>
        {total} {showResolved ? "în total" : "nerezolvate"}
        {merchantSlug ? ` · ${merchants.find((m) => m.slug === merchantSlug)?.name ?? merchantSlug}` : ""}
        {pages > 1 ? ` · pagina ${page} din ${pages}` : ""}
      </p>

      {rows.length === 0 ? (
        <div className="empty" style={{ marginTop: 24 }}>
          <p>Nimic refuzat aici. Asta e o veste bună doar dacă scraperele chiar au rulat.</p>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, minWidth: 900 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "2px solid var(--border)" }}>
                <th style={{ padding: "8px 10px 8px 0" }}>Produs</th>
                <th style={{ padding: "8px 10px" }}>Magazin</th>
                <th style={{ padding: "8px 10px", textAlign: "right" }}>Refuzat</th>
                <th style={{ padding: "8px 10px", textAlign: "right" }}>Păstrat</th>
                <th style={{ padding: "8px 10px" }}>Sursă</th>
                <th style={{ padding: "8px 10px" }}>Motiv</th>
                <th style={{ padding: "8px 0 8px 10px" }}>Când</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const name = r.offer?.product.name ?? r.storeName ?? "(fără nume)";
                const href = r.offer?.product.slug ? `/p/${r.offer.product.slug}` : null;
                return (
                  <tr key={r.id} style={{ borderBottom: "1px solid var(--border)", opacity: r.resolved ? 0.5 : 1 }}>
                    <td style={{ padding: "8px 10px 8px 0", maxWidth: 320 }}>
                      {href ? <Link href={href} style={{ color: "var(--primary)" }}>{name}</Link> : name}
                      {!r.offer && (
                        <span className="muted" style={{ display: "block", fontSize: 11.5 }}>
                          refuzat înainte de a deveni ofertă
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "8px 10px" }}>{r.merchant?.name ?? "—"}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--danger, #c0392b)" }}>
                      {r.rejectedPriceBani > 0 ? lei(r.rejectedPriceBani) : "necitibil"}
                    </td>
                    <td style={{ padding: "8px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {r.acceptedPriceBani == null ? <span className="muted">nimic</span> : lei(r.acceptedPriceBani)}
                    </td>
                    <td style={{ padding: "8px 10px", fontFamily: "ui-monospace, monospace", fontSize: 12, maxWidth: 180, overflowWrap: "anywhere" }}>
                      {r.rawPriceText ?? <span className="muted">—</span>}
                    </td>
                    <td style={{ padding: "8px 10px", maxWidth: 260 }} className="muted">{r.reason}</td>
                    <td style={{ padding: "8px 0 8px 10px", whiteSpace: "nowrap" }} className="muted">{formatDate(r.detectedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
          {page > 1 && <Link className="btn" href={`/admin/anomalies${qs({ page: String(page - 1) })}`}>← Înapoi</Link>}
          {page < pages && <Link className="btn" href={`/admin/anomalies${qs({ page: String(page + 1) })}`}>Înainte →</Link>}
        </div>
      )}
    </div>
  );
}
