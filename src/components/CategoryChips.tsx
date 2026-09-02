"use client";
// Category chips that WRAP instead of scrolling sideways.
//
// The old version was an `overflow-x: auto` strip with `white-space: nowrap`, which produced a
// native horizontal scrollbar under the chips on every section page — two stacked ones where a
// page had its own chip row as well. On /dcneu that strip was 21,249px wide inside a 1,160px
// column: a category list you navigate by dragging, where everything past "Apa De Gura" is
// invisible and undiscoverable.
//
// Chips wrap now. Past two rows the list is clamped and an expander reveals the rest, so a
// section with 8 categories shows all 8 and one with 400 does not push the products off screen.
//
// THE CLAMP IS CLOSED BEFORE HYDRATION. The server renders it already clamped by a CSS class,
// because measuring first would paint 400 chips and then collapse them — a full-page reflow the
// visitor sees. The class is a conservative fallback; once mounted we replace it with a MEASURED
// height, since chip height depends on font size and a hard-coded pixel value clips differently
// at every zoom level and in every browser.

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

export type Chip = { key: string; href: string; label: string; active: boolean };

const ROWS_SHOWN = 2;

type Fit = { kind: "unmeasured" } | { kind: "fits" } | { kind: "clamped"; maxHeight: number; hidden: number };

export function CategoryChips({ chips, label = "categoriile" }: { chips: Chip[]; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<Fit>({ kind: "unmeasured" });
  const [expanded, setExpanded] = useState(false);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const kids = Array.from(el.children) as HTMLElement[];
    if (kids.length === 0) return setFit({ kind: "fits" });

    // Distinct row offsets, in order. Rounded because sub-pixel layout gives 40 and 40.0001.
    const tops: number[] = [];
    for (const k of kids) {
      const t = Math.round(k.offsetTop);
      if (!tops.includes(t)) tops.push(t);
    }
    tops.sort((a, b) => a - b);

    if (tops.length <= ROWS_SHOWN) return setFit({ kind: "fits" });
    const gap = parseFloat(getComputedStyle(el).rowGap || "8") || 8;
    setFit({
      kind: "clamped",
      maxHeight: tops[ROWS_SHOWN] - tops[0] - gap,
      hidden: kids.filter((k) => Math.round(k.offsetTop) >= tops[ROWS_SHOWN]).length,
    });
  }, []);

  useEffect(() => {
    // Measure against the FULL list, so releasing the clamp first is required — otherwise every
    // chip below the fold reports the clamped container's offsetTop and the count is wrong.
    const el = ref.current;
    if (!el) return;
    const run = () => {
      const prev = el.style.maxHeight;
      el.style.maxHeight = "none";
      measure();
      el.style.maxHeight = prev;
    };
    run();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(run);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener("resize", run);
    return () => window.removeEventListener("resize", run);
  }, [measure, chips.length]);

  const closed = !expanded && fit.kind !== "fits";
  const style = closed && fit.kind === "clamped" ? { maxHeight: fit.maxHeight, overflow: "hidden" as const } : undefined;

  return (
    <div className="chipsblock">
      <div
        ref={ref}
        className={closed && fit.kind === "unmeasured" ? "chiprow chiprow-closed" : "chiprow"}
        style={style}
      >
        {chips.map((c) => (
          <Link key={c.key} href={c.href} className={c.active ? "chip active" : "chip"}>
            {c.label}
          </Link>
        ))}
      </div>
      {fit.kind === "clamped" && (
        <button type="button" className="chip chip-more" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
          {expanded ? "Mai puține ▴" : `Toate ${label} (+${fit.hidden}) ▾`}
        </button>
      )}
    </div>
  );
}
