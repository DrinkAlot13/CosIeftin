"use client";
// A CSV download of the same data already rendered in the chart above it — for anyone who wants
// to look at the numbers themselves rather than read a line on a graph. No server round-trip:
// the data is already on the page, so this just reshapes and downloads it.

type Series = { name: string; prices: (number | null)[] };

export function PriceHistoryExport({ dates, series, productName }: { dates: string[]; series: Series[]; productName: string }) {
  if (dates.length === 0 || series.length === 0) return null;

  function download() {
    const header = ["data", ...series.map((s) => s.name)];
    const rows = dates.map((d, i) => [d, ...series.map((s) => (s.prices[i] != null ? String(s.prices[i]) : ""))]);
    const csv = [header, ...rows].map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${productName.slice(0, 60).replace(/[^a-z0-9]+/gi, "-")}-istoric-preturi.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button type="button" className="linklike" style={{ fontSize: 12.5 }} onClick={download}>
      ⬇ Descarcă istoricul (CSV)
    </button>
  );
}
