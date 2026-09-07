// The basket's cost over time, ACROSS A VERSION CHANGE.
//
// ── THE ONE RULE THIS COMPONENT EXISTS TO ENFORCE: THE LINE DOES NOT CROSS.
//
// v1 priced forty pinned products. v2 prices forty equivalence classes. They are different
// baskets, so the step between the last v1 day and the first v2 day is a change of DEFINITION,
// not of price. Drawing one line through both would publish that step as inflation — the exact
// error the pinned basket was introduced to prevent, arriving one level up.
//
// So the two series are drawn as two segments, in two colours, separated by a dashed rule that
// is labelled. They share a y-axis because both are lei and a reader should see the level shift;
// they share nothing else. There is deliberately no code path that concatenates them.
//
// Incomplete days stay hollow and unjoined, as before: a day that priced 37 of 40 lines cost
// less than one that priced 40, and joining them draws a fall that did not happen.

import type { StoredPoint } from "@/lib/index-series-v2";

const W = 720;
const H = 270;
const PADL = 52;
const PADR = 16;
const PADT = 18;
const PADB = 40;
/** Horizontal gap at the version break, in px. Wide enough to read as a break, not a gap in data. */
const BREAK_GAP = 26;

function niceTicks(lo: number, hi: number, n = 4): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(v);
  return out;
}

export function VersionedBasketChart({ v1, v2 }: { v1: StoredPoint[]; v2: StoredPoint[] }) {
  const all = [...v1, ...v2];
  if (all.length < 2) {
    return (
      <div className="pill-note">
        Seria are {all.length === 1 ? "o singură zi" : "prea puține zile"} de măsurători — graficul
        apare după cel puțin două zile.
      </div>
    );
  }

  const totals = all.map((p) => p.total);
  const lo = Math.min(...totals);
  const hi = Math.max(...totals);
  const span = hi - lo || Math.max(1, hi * 0.05);
  const yLo = lo - span * 0.25;
  const yHi = hi + span * 0.25;

  // Each version gets a share of the width proportional to its number of days, with a fixed gap
  // between. The x-axis is therefore ORDINAL, not a time scale — and it must be, because the two
  // halves are not on one continuous axis in any meaningful sense.
  const usable = W - PADL - PADR - BREAK_GAP;
  const n1 = Math.max(v1.length, 1);
  const n2 = Math.max(v2.length, 1);
  const w1 = (usable * n1) / (n1 + n2);
  const w2 = usable - w1;
  const breakX = PADL + w1 + BREAK_GAP / 2;

  const x1 = (i: number) => (v1.length === 1 ? PADL + w1 / 2 : PADL + (i / (v1.length - 1)) * w1);
  const x2 = (i: number) => (v2.length === 1 ? PADL + w1 + BREAK_GAP + w2 / 2 : PADL + w1 + BREAK_GAP + (i / (v2.length - 1)) * w2);
  const y = (v: number) => PADT + (1 - (v - yLo) / (yHi - yLo)) * (H - PADT - PADB);

  const pathFor = (pts: StoredPoint[], xf: (i: number) => number): string[] => {
    const segs: string[] = [];
    let cur: string[] = [];
    pts.forEach((p, i) => {
      if (p.complete) cur.push(`${cur.length === 0 ? "M" : "L"}${xf(i).toFixed(1)},${y(p.total).toFixed(1)}`);
      else if (cur.length) { segs.push(cur.join(" ")); cur = []; }
    });
    if (cur.length) segs.push(cur.join(" "));
    return segs;
  };

  const ticks = niceTicks(yLo, yHi);

  const dots = (pts: StoredPoint[], xf: (i: number) => number, colour: string, version: number) =>
    pts.map((p, i) => (
      <g key={`v${version}-${p.day}`}>
        <circle
          cx={xf(i)} cy={y(p.total)} r={p.complete ? 4 : 4.5}
          fill={p.complete ? colour : "var(--surface)"}
          stroke={colour} strokeWidth={p.complete ? 0 : 2}
          strokeDasharray={p.complete ? undefined : "2 2"}
        />
        <title>
          {`${p.day} · coș v${version}: ${p.total.toFixed(2)} lei · ${p.covered}/${p.of} linii${p.complete ? "" : " (incomplet)"}`}
        </title>
      </g>
    ));

  return (
    <div className="card" style={{ padding: 14 }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label="Costul coșului în timp, pe două versiuni de coș care nu sunt comparabile">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PADL} x2={W - PADR} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth="1" />
            <text x={PADL - 8} y={y(t)} textAnchor="end" dominantBaseline="central" fontSize="11" fill="var(--muted)">
              {t.toFixed(0)}
            </text>
          </g>
        ))}

        {/* THE BREAK. Named on the chart itself, not only in the caption underneath — a chart
            gets screenshotted away from its caption. */}
        {v1.length > 0 && v2.length > 0 && (
          <g>
            <line x1={breakX} x2={breakX} y1={PADT} y2={H - PADB} stroke="var(--danger)" strokeWidth="1.5" strokeDasharray="5 4" />
            <text x={breakX} y={PADT - 4} textAnchor="middle" fontSize="10.5" fontWeight="700" fill="var(--danger)">
              coș nou — seriile nu se compară
            </text>
          </g>
        )}

        {pathFor(v1, x1).map((d, i) => (
          <path key={`p1-${i}`} d={d} fill="none" stroke="var(--muted)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {pathFor(v2, x2).map((d, i) => (
          <path key={`p2-${i}`} d={d} fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        ))}

        {dots(v1, x1, "var(--muted)", 1)}
        {dots(v2, x2, "var(--primary)", 2)}

        {v1.length > 0 && (
          <text x={PADL + w1 / 2} y={H - 14} textAnchor="middle" fontSize="11" fill="var(--muted)">
            v1 · {v1[0].day.slice(5)} – {v1[v1.length - 1].day.slice(5)} · {v1.length} zile
          </text>
        )}
        {v2.length > 0 && (
          <text x={PADL + w1 + BREAK_GAP + w2 / 2} y={H - 14} textAnchor="middle" fontSize="11" fill="var(--primary)">
            v2 · {v2[0].day.slice(5)}
            {v2.length > 1 ? ` – ${v2[v2.length - 1].day.slice(5)}` : ""} · {v2.length} {v2.length === 1 ? "zi" : "zile"}
          </text>
        )}
      </svg>
    </div>
  );
}
