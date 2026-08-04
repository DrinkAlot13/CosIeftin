"use client";

import { useRef, useState } from "react";
import { formatRON } from "@/lib/format";

type Series = { name: string; colorIndex: number; prices: (number | null)[] };

// Interactive multi-shop price history. Hovering shows a crosshair + tooltip with
// every shop's price at that date (cheapest marked). Categorical palette + per-shop
// legend come from the validated dataviz palette (see globals.css .viz --s1..8).
const W = 760;
const H = 300;
const M = { t: 16, r: 16, b: 28, l: 58 };

export function PriceHistoryChart({ dates, series }: { dates: string[]; series: Series[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ i: number; left: number } | null>(null);

  const all = series.flatMap((s) => s.prices).filter((v): v is number => v != null);
  if (dates.length < 2 || all.length === 0) {
    return <div className="pill-note">Nu există încă suficiente date de preț pentru un grafic.</div>;
  }

  const min = Math.min(...all);
  const max = Math.max(...all);
  const pad = (max - min) * 0.12 || max * 0.05;
  const yMin = Math.max(0, min - pad);
  const yMax = max + pad;

  const iw = W - M.l - M.r;
  const ih = H - M.t - M.b;
  const x = (i: number) => M.l + (i / (dates.length - 1)) * iw;
  const y = (v: number) => M.t + ih - ((v - yMin) / (yMax - yMin || 1)) * ih;

  function onMove(e: React.MouseEvent) {
    const svg = svgRef.current;
    const wrap = wrapRef.current;
    if (!svg || !wrap) return;
    const rect = svg.getBoundingClientRect();
    const scale = W / rect.width;
    const vbX = (e.clientX - rect.left) * scale;
    let i = Math.round(((vbX - M.l) / iw) * (dates.length - 1));
    i = Math.max(0, Math.min(dates.length - 1, i));
    const wrapRect = wrap.getBoundingClientRect();
    let left = e.clientX - wrapRect.left + 14;
    left = Math.max(8, Math.min(left, wrapRect.width - 200));
    setHover({ i, left });
  }

  const gridVals = [yMax, (yMax + yMin) / 2, yMin];
  const rows = hover
    ? series
        .map((s) => ({ name: s.name, colorIndex: s.colorIndex, price: s.prices[hover.i] }))
        .filter((r): r is { name: string; colorIndex: number; price: number } => r.price != null)
        .sort((a, b) => a.price - b.price)
    : [];
  const lowest = rows.length ? rows[0].price : null;

  return (
    <div className="viz" ref={wrapRef} style={{ position: "relative" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="chart-svg"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`Evoluția prețurilor pe ${series.length} magazine în ${dates.length} zile`}
      >
        {gridVals.map((v, idx) => (
          <g key={idx}>
            <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} style={{ stroke: "var(--border)" }} strokeWidth={1} />
            <text x={M.l - 8} y={y(v)} textAnchor="end" dominantBaseline="central" fontSize={11} style={{ fill: "var(--muted)" }}>
              {Math.round(v).toLocaleString("ro-RO")} lei
            </text>
          </g>
        ))}

        {series.map((s, si) => {
          const pts = s.prices
            .map((p, i) => (p == null ? null : `${x(i).toFixed(1)},${y(p).toFixed(1)}`))
            .filter(Boolean)
            .join(" ");
          return (
            <polyline
              key={si}
              points={pts}
              fill="none"
              style={{ stroke: `var(--s${s.colorIndex})` }}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={0.9}
            />
          );
        })}

        {hover && (
          <>
            <line
              x1={x(hover.i)}
              x2={x(hover.i)}
              y1={M.t}
              y2={M.t + ih}
              style={{ stroke: "var(--muted)" }}
              strokeWidth={1}
              strokeDasharray="4 3"
            />
            {series.map((s, si) =>
              s.prices[hover.i] != null ? (
                <circle
                  key={si}
                  cx={x(hover.i)}
                  cy={y(s.prices[hover.i]!)}
                  r={3.5}
                  style={{ fill: `var(--s${s.colorIndex})`, stroke: "var(--surface)" }}
                  strokeWidth={1.5}
                />
              ) : null,
            )}
          </>
        )}

        <text x={M.l} y={H - 8} textAnchor="start" fontSize={11} style={{ fill: "var(--muted)" }}>
          {dates[0].slice(5)}
        </text>
        <text x={W - M.r} y={H - 8} textAnchor="end" fontSize={11} style={{ fill: "var(--muted)" }}>
          {dates[dates.length - 1].slice(5)}
        </text>
      </svg>

      {hover && rows.length > 0 && (
        <div className="viz-tooltip" style={{ left: hover.left }}>
          <div className="viz-tt-date">{dates[hover.i]}</div>
          {rows.map((r, ri) => (
            <div className="viz-tt-row" key={ri}>
              <span className="viz-sw" style={{ background: `var(--s${r.colorIndex})` }} />
              <span className="viz-tt-name">{r.name}</span>
              <span className="viz-tt-price">
                {formatRON(r.price)}
                {r.price === lowest ? " ✓" : ""}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="viz-legend">
        {series.map((s, si) => (
          <span className="viz-leg" key={si}>
            <span className="viz-sw" style={{ background: `var(--s${s.colorIndex})` }} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}
