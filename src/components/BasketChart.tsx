// The basket's cost over time, as a plain server-rendered SVG.
//
// INCOMPLETE POINTS ARE DRAWN DIFFERENTLY, not smoothed over. A day where we could price 37 of
// 40 lines costs less than a day where we priced all 40, and joining the two with a straight
// line would draw a price fall that did not happen. Complete days are a solid line with filled
// dots; incomplete days are hollow dots and are not joined into the line.

import type { SeriesPoint } from "@/lib/index-series";

const W = 720;
const H = 260;
const PADL = 52;
const PADR = 16;
const PADT = 16;
const PADB = 34;

function niceTicks(lo: number, hi: number, n = 4): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(v);
  return out;
}

export function BasketChart({ points }: { points: SeriesPoint[] }) {
  const usable = points.filter((p) => p.priced > 0);
  if (usable.length < 2) {
    return (
      <div className="pill-note">
        Seria are {usable.length === 1 ? "o singură zi" : "prea puține zile"} de măsurători — graficul
        apare după cel puțin două zile în care am putut evalua coșul.
      </div>
    );
  }

  const totals = usable.map((p) => p.total);
  const lo = Math.min(...totals);
  const hi = Math.max(...totals);
  // Never a zero-height band: a flat series would otherwise divide by zero.
  const span = hi - lo || Math.max(1, hi * 0.05);
  const yLo = lo - span * 0.25;
  const yHi = hi + span * 0.25;

  const x = (i: number) => PADL + (i / (usable.length - 1)) * (W - PADL - PADR);
  const y = (v: number) => PADT + (1 - (v - yLo) / (yHi - yLo)) * (H - PADT - PADB);

  // The solid line joins only CONSECUTIVE complete points; a gap breaks it.
  const segments: string[] = [];
  let cur: string[] = [];
  usable.forEach((p, i) => {
    if (p.complete) cur.push(`${cur.length === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.total).toFixed(1)}`);
    else if (cur.length) { segments.push(cur.join(" ")); cur = []; }
  });
  if (cur.length) segments.push(cur.join(" "));

  const ticks = niceTicks(yLo, yHi);

  return (
    <div className="card" style={{ padding: 14 }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label="Costul coșului în timp">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PADL} x2={W - PADR} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth="1" />
            <text x={PADL - 8} y={y(t)} textAnchor="end" dominantBaseline="central" fontSize="11" fill="var(--muted)">
              {t.toFixed(0)}
            </text>
          </g>
        ))}
        {segments.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {usable.map((p, i) => (
          <g key={p.day}>
            <circle
              cx={x(i)} cy={y(p.total)} r={p.complete ? 4 : 4.5}
              fill={p.complete ? "var(--primary)" : "var(--surface)"}
              stroke="var(--primary)" strokeWidth={p.complete ? 0 : 2}
              strokeDasharray={p.complete ? undefined : "2 2"}
            />
            <title>
              {`${p.day}: ${p.total.toFixed(2)} lei · ${p.priced}/${p.of} produse${p.complete ? "" : " (incomplet)"}`}
            </title>
          </g>
        ))}
        {usable.map((p, i) =>
          // Only label the ends and every other point, so 30 dates do not overlap into a smear.
          i === 0 || i === usable.length - 1 || usable.length <= 8 ? (
            <text key={p.day} x={x(i)} y={H - 12} textAnchor="middle" fontSize="11" fill="var(--muted)">
              {p.day.slice(5)}
            </text>
          ) : null,
        )}
      </svg>
      <p className="muted" style={{ fontSize: 12.5, margin: "6px 0 0" }}>
        Punctele pline sunt zile în care am avut preț pentru toate cele {usable[0].of} produse.
        Punctele goale sunt zile incomplete — linia se întrerupe acolo, pentru că un coș cu mai
        puține produse costă mai puțin și nu e o scădere de preț.
      </p>
    </div>
  );
}
