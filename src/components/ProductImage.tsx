"use client";
// Product image with an honest failure state.
//
// Three ways an image can fail to arrive, and all three now end in the SAME static placeholder
// carrying the product's name:
//
//   1. no URL at all                 — 1 product in the catalog
//   2. a URL that is the site's own loading spinner — 962 products; see lib/placeholder-image.
//      These return HTTP 200 and animate forever, so `onError` never fires. They are refused
//      before they are ever put in an `<img>`.
//   3. a URL that 404s, or never finishes loading — caught by `onError` and by a 3s timer.
//
// The timer matters because "still loading" and "will never load" look identical to a visitor,
// and the second is much more common than the first on a page of 48 remote images. After 3
// seconds we stop claiming the image is coming.
//
// The fallback is STATIC. An animated shimmer says "wait"; if we know the picture is not
// coming, saying "wait" is a lie, and it is exactly what the user reported seeing forever.

import { useEffect, useRef, useState } from "react";
import { usableImageUrl } from "@/lib/placeholder-image";

/** How long we are willing to claim an image is still on its way. */
const LOAD_TIMEOUT_MS = 3000;

function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

/** The static, named placeholder. No animation anywhere in it. */
function NamePlaceholder({ name, brand }: { name: string; brand?: string | null }) {
  const key = brand || name;
  const h = hashHue(key);
  const id = `g${Math.abs(hashHue(name))}`;
  // The product's own name, wrapped onto at most three lines. A visitor who cannot see the
  // picture can still tell which product this card is.
  const words = name.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > 22) { if (cur) lines.push(cur); cur = w; }
    else cur = (cur + " " + w).trim();
    if (lines.length === 3) break;
  }
  if (cur && lines.length < 3) lines.push(cur);

  return (
    <svg viewBox="0 0 200 200" className="pimg-fallback" role="img" aria-label={name} style={{ width: "82%" }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={`hsl(${h} 70% 60%)`} />
          <stop offset="100%" stopColor={`hsl(${(h + 40) % 360} 65% 45%)`} />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="188" height="188" rx="20" fill={`url(#${id})`} opacity="0.14" />
      <circle cx="100" cy="62" r="34" fill={`url(#${id})`} />
      <text x="100" y="62" textAnchor="middle" dominantBaseline="central" fontSize="28" fontWeight="800" fill="#fff">
        {(brand && brand.trim() && brand !== "X Y" ? brand : name).slice(0, 2).toUpperCase()}
      </text>
      {lines.map((l, i) => (
        <text key={i} x="100" y={120 + i * 19} textAnchor="middle" fontSize="15" fontWeight="600" fill="hsl(220 12% 42%)">
          {l}
        </text>
      ))}
      <text x="100" y="188" textAnchor="middle" fontSize="11" fontWeight="600" fill="hsl(220 10% 60%)">
        fără imagine
      </text>
    </svg>
  );
}

export function ProductImage({ name, brand, src }: { name: string; brand?: string | null; src?: string | null }) {
  // Refused before render: a known spinner URL is not a "loading" state, it is a wrong value.
  const usable = usableImageUrl(src);
  const [failed, setFailed] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!usable) return;
    setFailed(false);
    setTimedOut(false);
    // A cached image can be complete before this effect runs; do not start a timer for it.
    if (imgRef.current?.complete) return;
    const t = setTimeout(() => {
      if (!imgRef.current?.complete) setTimedOut(true);
    }, LOAD_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [usable]);

  if (!usable || failed || timedOut) return <NamePlaceholder name={name} brand={brand} />;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imgRef}
      src={usable}
      alt={name}
      className="pimg-img"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
