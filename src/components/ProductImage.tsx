// Deterministic inline-SVG placeholder so the MVP needs no external image hosting.
// When real feed image_link URLs are ingested, swap this for <Image> / <img>.

function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

export function ProductImage({ name, brand, src }: { name: string; brand?: string | null; src?: string | null }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={name} className="pimg-img" loading="lazy" />;
  }
  const key = brand || name;
  const h = hashHue(key);
  const label = (brand || name.split(" ")[0]).slice(0, 14);
  const id = `g${Math.abs(hashHue(name))}`;
  return (
    <svg viewBox="0 0 200 200" className="chart-svg" role="img" aria-label={name} style={{ width: "72%" }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={`hsl(${h} 70% 60%)`} />
          <stop offset="100%" stopColor={`hsl(${(h + 40) % 360} 65% 45%)`} />
        </linearGradient>
      </defs>
      <rect x="10" y="10" width="180" height="180" rx="22" fill={`url(#${id})`} opacity="0.16" />
      <circle cx="100" cy="82" r="42" fill={`url(#${id})`} />
      <text x="100" y="82" textAnchor="middle" dominantBaseline="central" fontSize="34" fontWeight="800" fill="#fff">
        {(brand || name).slice(0, 2).toUpperCase()}
      </text>
      <text x="100" y="150" textAnchor="middle" fontSize="17" fontWeight="700" fill="hsl(220 15% 45%)">
        {label}
      </text>
    </svg>
  );
}
