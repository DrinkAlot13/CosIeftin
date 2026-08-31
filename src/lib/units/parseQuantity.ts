// Pack-size parsing for Romanian product names (see CLAUDE.md → Units).
//
// Canonical units are G, ML and BUC — everything normalizes to these, so unit prices
// (lei/kg, lei/L) are computed on one scale and never on a mix of kg and g.
//
// MULTIPACKS MUST NOT COLLAPSE. "6x1.5L" is 9000 ML of product, but it is also a
// six-pack of 1.5 L bottles. Treating it as a single 1.5 L bottle understates the pack
// by 6× and makes the unit price wrong; forgetting it was a six-pack loses the shape a
// shopper is actually buying. So we return BOTH: `value` (total) and `packCount`/`packSize`.

export type CanonicalUnit = "G" | "ML" | "BUC";

export type Quantity = {
  /** TOTAL amount in the canonical unit (a 6x1.5L pack is 9000 ML) */
  value: number;
  unit: CanonicalUnit;
  /** how many items in the pack (1 for a single item) */
  packCount: number;
  /** the size of ONE item in the pack, in the canonical unit */
  packSize: number;
};

// Every mass/volume/count word we've seen on Romanian labels, with its factor to canonical.
const UNIT_MAP: { re: RegExp; unit: CanonicalUnit; factor: number }[] = [
  { re: /^(?:kg|kilograme?|kilo)$/i, unit: "G", factor: 1000 },
  { re: /^(?:g|gr|grame?)$/i, unit: "G", factor: 1 },
  { re: /^(?:mg|miligrame?)$/i, unit: "G", factor: 0.001 },
  { re: /^(?:l|litri?|litru)$/i, unit: "ML", factor: 1000 },
  { re: /^(?:cl|centilitri?)$/i, unit: "ML", factor: 10 },
  { re: /^(?:ml|mililitri?)$/i, unit: "ML", factor: 1 },
  {
    re: /^(?:buc|bucata|bucati|bucăți|bucăţi|bucată|role|rola|plicuri|plic|capsule|caps|comprimate|compr|tablete|doze|felii|oua|ouă)$/i,
    unit: "BUC",
    factor: 1,
  },
];

const UNIT_WORDS = "kg|kilograme|kilogram|kilo|gr|grame|gram|mg|miligrame|ml|mililitri|cl|centilitri|litri|litru|g|l|buc|bucata|bucati|bucăți|bucăţi|bucată|role|rola|plicuri|plic|capsule|caps|comprimate|compr|tablete|doze|felii|ouă|oua";

function toCanonical(amount: number, unitWord: string): { value: number; unit: CanonicalUnit } | null {
  for (const u of UNIT_MAP) {
    if (u.re.test(unitWord)) {
      const value = amount * u.factor;
      return Number.isFinite(value) && value > 0 ? { value: round(value), unit: u.unit } : null;
    }
  }
  return null;
}

/** Keep sub-gram/ml precision without float noise (0.001 g steps). */
function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Romanian labels use both "1,5" and "1.5". */
function num(s: string): number {
  return parseFloat(s.replace(",", "."));
}

/**
 * Parse a pack size out of a Romanian product name.
 * @returns the canonical quantity, or null when the name declares no size.
 */
export function parseQuantity(input: string | null | undefined): Quantity | null {
  if (input == null) return null;
  const s = String(input).replace(/[  ]/g, " ").trim();
  if (!s) return null;

  // ── 1a) PROMOTIONAL multipack: "(7+1) x 125 g", "4+2 x 125 g", "5+1 x 0.5L".
  //    Romanian retail writes "buy N get M free" this way, and the shopper takes home N+M.
  //    This MUST be tried before the plain multipack rule, which would otherwise read only
  //    the number nearest the × — turning an 8-pack of yoghurt into a single 125 g pot and
  //    making its price look ~8x too high against every other store.
  const promo = s.match(
    new RegExp(String.raw`\(?\s*(\d+)\s*\+\s*(\d+)\s*\)?\s*(?:buc|bucati|bucăți)?\s*[x×*]\s*([\d.,]+)\s*(${UNIT_WORDS})\b`, "i"),
  );
  if (promo) {
    const count = parseInt(promo[1], 10) + parseInt(promo[2], 10);
    const one = toCanonical(num(promo[3]), promo[4]);
    if (one && count > 0) {
      return { value: round(one.value * count), unit: one.unit, packCount: count, packSize: one.value };
    }
  }

  // ── 1b) multipack with an explicit unit: "6x1.5L", "4 x 330 ml", "2×1,5l", "3 buc x 100g"
  //    The optional "buc" between the count and the × is common on RO labels.
  const multi = s.match(
    new RegExp(String.raw`(\d+)\s*(?:buc|bucati|bucăți)?\s*[x×*]\s*([\d.,]+)\s*(${UNIT_WORDS})\b`, "i"),
  );
  if (multi) {
    const count = parseInt(multi[1], 10);
    const one = toCanonical(num(multi[2]), multi[3]);
    if (one && count > 0) {
      return { value: round(one.value * count), unit: one.unit, packCount: count, packSize: one.value };
    }
  }

  // ── 2) reversed multipack: "1.5L x 6", "330 ml × 4"
  const multiRev = s.match(new RegExp(String.raw`([\d.,]+)\s*(${UNIT_WORDS})\s*[x×*]\s*(\d+)\b`, "i"));
  if (multiRev) {
    const one = toCanonical(num(multiRev[1]), multiRev[2]);
    const count = parseInt(multiRev[3], 10);
    if (one && count > 0) {
      return { value: round(one.value * count), unit: one.unit, packCount: count, packSize: one.value };
    }
  }

  // ── 3) single quantity with a unit: "500 g", "0,5 kg", "1,5 L", "250ml", "10 bucăți"
  //    Scan ALL matches and keep the last one: RO names lead with the product
  //    ("Lapte 1,5% grăsime 1L") and the percentage would otherwise win.
  const singleRe = new RegExp(String.raw`([\d.,]+)\s*(${UNIT_WORDS})\b`, "gi");
  let best: { value: number; unit: CanonicalUnit } | null = null;
  let m: RegExpExecArray | null;
  while ((m = singleRe.exec(s))) {
    // "1,5%" is fat content, not a size — skip anything immediately followed by %
    const after = s.slice(m.index + m[0].length).trimStart();
    if (after.startsWith("%")) continue;
    const q = toCanonical(num(m[1]), m[2]);
    if (q) best = q;
  }
  if (best) return { value: best.value, unit: best.unit, packCount: 1, packSize: best.value };

  // ── 4) a bare count with a counting noun already covered above; nothing found
  return null;
}

/** Human label for a canonical quantity: 9000 ML in 6 → "6 x 1,5 l". */
export function formatQuantity(q: Quantity): string {
  const one = (v: number, unit: CanonicalUnit): string => {
    if (unit === "BUC") return `${trim(v)} buc`;
    if (unit === "G") return v >= 1000 ? `${trim(v / 1000)} kg` : `${trim(v)} g`;
    return v >= 1000 ? `${trim(v / 1000)} l` : `${trim(v)} ml`;
  };
  return q.packCount > 1 ? `${q.packCount} x ${one(q.packSize, q.unit)}` : one(q.value, q.unit);
}

function trim(n: number): string {
  return String(Math.round(n * 1000) / 1000).replace(".", ",");
}

/** The divisor for a lei-per-unit figure: per kg, per litre, or per piece. */
export function perUnitDivisor(q: Quantity): { divisor: number; label: string } {
  if (q.unit === "BUC") return { divisor: q.value, label: "buc" };
  if (q.unit === "G") return { divisor: q.value / 1000, label: "kg" };
  return { divisor: q.value / 1000, label: "l" };
}
