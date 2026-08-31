// Pack-size parsing for Romanian product names (see CLAUDE.md → Units).
//
// Canonical units are G, ML and BUC — everything normalizes to these, so unit prices
// (lei/kg, lei/L) are computed on one scale and never on a mix of kg and g.
//
// MULTIPACKS MUST NOT COLLAPSE. "6x1.5L" is 9000 ML of product, but it is also a
// six-pack of 1.5 L bottles. Treating it as a single 1.5 L bottle understates the pack
// by 6× and makes the unit price wrong; forgetting it was a six-pack loses the shape a
// shopper is actually buying. So we return BOTH: `value` (total) and `packCount`/`packSize`.
//
// PROMOTIONAL PACKS ARE A DIFFERENT THING AGAIN. "(7+1) x 125 g" and "2+1 gratis" describe
// a pack that exists only while the promotion runs. Two consequences, both load-bearing:
//
//   1. The shopper takes home 8 pots, not 1 and not 7 — the DB audit found Activia yoghurt
//      recorded at 14,63 lei against a 2,59 cross-store median purely because "(7+1) x 125 g"
//      parsed as a single 125 g pot.
//   2. When the promo ends the pack reverts. A downstream shrinkflation detector comparing
//      8x125 g to 7x125 g must NOT call that shrinkflation — it is promo expiry. That is what
//      `isPromoPack` exists to say, and it is why paid and free counts are kept apart rather
//      than folded into one number.
//
// The parse runs in two stages: find the promotional shape first (if any), then read the base
// pack from what is left. Doing it the other way round lets a promo's own digits be misread as
// the pack — "4+2 x 125 g" reads as a plain "2 x 125 g" two-pack under the multipack rule.

export type CanonicalUnit = "G" | "ML" | "BUC";

export type Quantity = {
  /** TOTAL amount in the canonical unit, INCLUDING free items (a 6x1.5L pack is 9000 ML) */
  value: number;
  unit: CanonicalUnit;
  /** how many items the shopper takes home (1 for a single item); always paidCount + freeCount */
  packCount: number;
  /** the size of ONE item in the pack, in the canonical unit */
  packSize: number;
  /** items actually paid for — differs from packCount only in a promotional pack */
  paidCount: number;
  /** items received free; 0 outside a promotion */
  freeCount: number;
  /** true when the pack shape exists only for the promotion and reverts when it ends */
  isPromoPack: boolean;
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

/** Counting nouns that may sit between a number and the × in "3 buc x 100g". */
const BUC_WORDS = "buc|bucata|bucati|bucăți|bucăţi|bucată";

/**
 * Every counting noun, for the multipack rule: "24 plicuri x 15 g" is 24 sachets of 15 g.
 * Narrower than this (just `buc`) and the reversed rule claims it instead, reading "24 plicuri
 * x 15" as 360 pieces and silently discarding the grams — which is what it did to every
 * instant-coffee and tea box in the catalog.
 */
const COUNT_NOUNS = "buc|bucata|bucati|bucăți|bucăţi|bucată|plicuri|pliculete|plic|role|rola|capsule|caps|comprimate|compr|tablete|doze|felii|pungi|cutii|cutie";

/**
 * A number, and NOTHING but a number. Not `[\d.,]+`, which swallows adjacent punctuation:
 * on "Albrau,0.5 l" that captured ",0.5", which parseFloat reads as 0 — a zero unitSize, and
 * a division by zero in every per-unit price computed from it.
 */
const NUM = String.raw`(\d+(?:[.,]\d+)?)`;

/** Mass and volume only — no counting nouns. Used to tell "x 15 g" from "x 3 bucati". */
const MEASURE_WORDS = "kg|kilograme|kilogram|kilo|gr|grame|gram|mg|miligrame|ml|mililitri|cl|centilitri|litri|litru|g|l";

/** "free" as Romanian retail writes it, both diacritic spellings. */
const GRATIS_WORDS = "gratis|gratuit[ăaeiț]?|gratuite|cadou|free";

/** Words that introduce a pack of pieces: "pachet 2 buc", "set 3 buc", "bax 24". */
const PACK_WORDS = "pachet|pachete|set|bax|baxuri|pack|cutie|cutii";

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

function make(
  value: number,
  unit: CanonicalUnit,
  packCount: number,
  packSize: number,
  paidCount: number,
  freeCount: number,
): Quantity {
  return {
    value: round(value),
    unit,
    packCount,
    packSize: round(packSize),
    paidCount,
    freeCount,
    isPromoPack: freeCount > 0,
  };
}

/** A plain, non-promotional reading. */
function plain(value: number, unit: CanonicalUnit, packCount: number, packSize: number): Quantity {
  return make(value, unit, packCount, packSize, packCount, 0);
}

// ── promotional shapes ────────────────────────────────────────────────────────────────

type PromoKind =
  /** "(7+1) x 125 g" — the promo states the item size itself */
  | "ATTACHED"
  /** "2+1 gratis", "3 la prețul de 2" — N and M count whole base packs */
  | "PACKS"
  /** "2 x 500 g + 1 gratis" — the free items are added to the base pack */
  | "SUFFIX";

type Promo = {
  kind: PromoKind;
  paidCount: number;
  freeCount: number;
  itemSize?: { value: number; unit: CanonicalUnit };
  /** the input with the promo wording removed, so the base parse cannot re-read its digits */
  rest: string;
};

function without(s: string, m: RegExpMatchArray): string {
  return s.slice(0, m.index) + " " + s.slice((m.index ?? 0) + m[0].length);
}

/**
 * Find the promotional shape, if the name states one.
 *
 * Deliberately conservative: a bare "N+M" is NOT a promotion. Romanian labels are full of
 * innocent plus signs ("Omega 3+6+9", "ECO Avocado 90 Gr+", "3+ ani"), so a promo must either
 * attach a pack size ("4+2 x 125 g") or carry an explicit free-word ("2+1 gratis"). Guessing
 * here would corrupt real quantities, which is a worse failure than missing a promo label.
 */
function detectPromo(s: string): Promo | null {
  // ATTACHED: "(7+1) x 125 g", "4+2 x 125 g", "5+1 x 0.5L"
  const attached = s.match(
    new RegExp(String.raw`\(?\s*(\d+)\s*\+\s*(\d+)\s*\)?\s*(?:${BUC_WORDS})?\s*[x×*]\s*${NUM}\s*(${UNIT_WORDS})\b`, "i"),
  );
  if (attached) {
    const one = toCanonical(num(attached[3]), attached[4]);
    const paid = parseInt(attached[1], 10);
    const free = parseInt(attached[2], 10);
    if (one && paid > 0 && free > 0) {
      return { kind: "ATTACHED", paidCount: paid, freeCount: free, itemSize: one, rest: without(s, attached) };
    }
  }

  // PACKS: "2+1 gratis", "1 + 1 GRATUIT", "2+1 buc cadou"
  // Requires digits on BOTH sides with nothing but space around the +, so "500 g + 1 gratis"
  // (a SUFFIX form) cannot be misread as a 500-paid / 1-free promotion.
  const pairFree = s.match(
    new RegExp(String.raw`(\d+)\s*\+\s*(\d+)\s*(?:${BUC_WORDS})?\s*(?:${GRATIS_WORDS})\b`, "i"),
  );
  if (pairFree) {
    const paid = parseInt(pairFree[1], 10);
    const free = parseInt(pairFree[2], 10);
    if (paid > 0 && free > 0) {
      return { kind: "PACKS", paidCount: paid, freeCount: free, rest: without(s, pairFree) };
    }
  }

  // PACKS: "3 la prețul de 2" (both diacritic spellings, and the diacritic-free scrape)
  const atPriceOf = s.match(/(\d+)\s*la\s*pre[țţt]ul\s*(?:de|a)\s*(\d+)/i);
  if (atPriceOf) {
    const total = parseInt(atPriceOf[1], 10);
    const paid = parseInt(atPriceOf[2], 10);
    if (total > paid && paid > 0) {
      return { kind: "PACKS", paidCount: paid, freeCount: total - paid, rest: without(s, atPriceOf) };
    }
  }

  // SUFFIX: "2 x 500 g + 1 gratis" — free items appended to a pack stated separately.
  // Tried last: the PACKS rule above would otherwise claim the "+1 gratis" tail of "2+1 gratis".
  const suffixFree = s.match(
    new RegExp(String.raw`\+\s*(\d+)\s*(?:${BUC_WORDS})?\s*(?:${GRATIS_WORDS})\b`, "i"),
  );
  if (suffixFree) {
    const free = parseInt(suffixFree[1], 10);
    if (free > 0) return { kind: "SUFFIX", paidCount: 0, freeCount: free, rest: without(s, suffixFree) };
  }

  return null;
}

// ── base pack ─────────────────────────────────────────────────────────────────────────

/** The non-promotional reading: multipack, reversed multipack, pack-word, or a single size. */
function parseBase(s: string): Quantity | null {
  // multipack with an explicit unit: "6x1.5L", "4 x 330 ml", "2×1,5l", "3 buc x 100g",
  // "24 plicuri x 15 g"
  const multi = s.match(
    new RegExp(String.raw`(\d+)\s*(?:${COUNT_NOUNS})?\s*[x×*]\s*${NUM}\s*(${UNIT_WORDS})\b`, "i"),
  );
  if (multi) {
    const count = parseInt(multi[1], 10);
    const one = toCanonical(num(multi[2]), multi[3]);
    if (one && count > 0) return plain(one.value * count, one.unit, count, one.value);
  }

  // reversed multipack: "1.5L x 6", "330 ml × 4", "10 g x 3 bucati".
  // The trailing count must not itself be a MASS OR VOLUME: in "24 plicuri x 15 g" the 15 is
  // grams, not a number of packs, and reading it as one gave 360 pieces of nothing. A counting
  // noun after it is fine and in fact confirms the reading — "10 g x 3 bucati" is three 10 g
  // sachets — so the guard names measures only, not every unit word.
  const multiRev = s.match(
    new RegExp(String.raw`${NUM}\s*(${UNIT_WORDS})\s*[x×*]\s*(\d+)\b(?!\s*(?:${MEASURE_WORDS})\b)`, "i"),
  );
  if (multiRev) {
    const one = toCanonical(num(multiRev[1]), multiRev[2]);
    const count = parseInt(multiRev[3], 10);
    if (one && count > 0) return plain(one.value * count, one.unit, count, one.value);
  }

  // pack word + an explicit count of PIECES: "pachet 2 buc", "set 3 buc", "bax 24 buc".
  // The counting noun is required (except after "bax", which means a case of pieces on its
  // own) so that "Set 2 pahare 250 ml" is still read as 250 ml and not as a two-pack — the
  // number after a pack word is only a pack count when the label says what it counts.
  const packWord = s.match(new RegExp(String.raw`\b(?:${PACK_WORDS})\s*(?:de\s*)?(\d+)\s*(${BUC_WORDS})\b`, "i"));
  if (packWord) {
    const count = parseInt(packWord[1], 10);
    if (count > 0) return plain(count, "BUC", count, 1);
  }
  const bax = s.match(/\bbax(?:uri)?\s*(?:de\s*)?(\d+)\b/i);
  if (bax) {
    const count = parseInt(bax[1], 10);
    if (count > 0) return plain(count, "BUC", count, 1);
  }

  // single quantity with a unit: "500 g", "0,5 kg", "1,5 L", "250ml", "10 bucăți"
  // Scan ALL matches and keep the last one: RO names lead with the product
  // ("Lapte 1,5% grăsime 1L") and the percentage would otherwise win.
  const singleRe = new RegExp(String.raw`${NUM}\s*(${UNIT_WORDS})\b`, "gi");
  let best: { value: number; unit: CanonicalUnit } | null = null;
  let m: RegExpExecArray | null;
  while ((m = singleRe.exec(s))) {
    // "1,5%" is fat content, not a size — skip anything immediately followed by %
    const after = s.slice(m.index + m[0].length).trimStart();
    if (after.startsWith("%")) continue;
    const q = toCanonical(num(m[1]), m[2]);
    if (q) best = q;
  }
  if (best) return plain(best.value, best.unit, 1, best.value);

  return null;
}

/**
 * Parse a pack size out of a Romanian product name.
 * @returns the canonical quantity, or null when the name declares no size.
 */
export function parseQuantity(input: string | null | undefined): Quantity | null {
  if (input == null) return null;
  const s = String(input).replace(/[    ⁠]/g, " ").trim();
  if (!s) return null;

  const promo = detectPromo(s);
  if (!promo) return parseBase(s);

  // The promo stated the item size itself: "(7+1) x 125 g" is eight 125 g pots.
  if (promo.kind === "ATTACHED" && promo.itemSize) {
    const count = promo.paidCount + promo.freeCount;
    const { value, unit } = promo.itemSize;
    return make(value * count, unit, count, value, promo.paidCount, promo.freeCount);
  }

  const base = parseBase(promo.rest);

  // "1+1 gratis" on a name that states no size at all. We still know the shopper leaves with
  // two of something, which is more than nothing — but the unit is pieces, not a guess at mass.
  if (!base) {
    const count = promo.kind === "SUFFIX" ? 1 + promo.freeCount : promo.paidCount + promo.freeCount;
    const paid = promo.kind === "SUFFIX" ? 1 : promo.paidCount;
    return make(count, "BUC", count, 1, paid, promo.freeCount);
  }

  // "2 x 500 g + 1 gratis" — the free items join the pack that was already stated, so they are
  // items of the pack's OWN size (500 g), not extra copies of the whole 2-pack.
  if (promo.kind === "SUFFIX") {
    const count = base.packCount + promo.freeCount;
    return make(base.packSize * count, base.unit, count, base.packSize, base.packCount, promo.freeCount);
  }

  // "2+1 gratis" — N and M count whole base packs, so one "item" is the entire base quantity.
  // For a plain 125 g pot that is 125 g; for "8 role" it is all eight rolls, and 2+1 means
  // three packs of eight.
  const count = promo.paidCount + promo.freeCount;
  return make(base.value * count, base.unit, count, base.value, promo.paidCount, promo.freeCount);
}

/** Human label for a canonical quantity: 9000 ML in 6 → "6 x 1,5 l". */
export function formatQuantity(q: Quantity): string {
  const one = (v: number, unit: CanonicalUnit): string => {
    if (unit === "BUC") return `${trim(v)} buc`;
    if (unit === "G") return v >= 1000 ? `${trim(v / 1000)} kg` : `${trim(v)} g`;
    return v >= 1000 ? `${trim(v / 1000)} l` : `${trim(v)} ml`;
  };
  // A pack of single pieces reads as "10 buc", never "10 x 1 buc".
  if (q.unit === "BUC" && q.packSize === 1) return `${trim(q.value)} buc`;
  return q.packCount > 1 ? `${q.packCount} x ${one(q.packSize, q.unit)}` : one(q.value, q.unit);
}

/** Shopper-facing promo label: "(7+1) x 125 g" → "7+1 gratis". Empty when not a promo. */
export function formatPromo(q: Quantity): string {
  return q.isPromoPack ? `${q.paidCount}+${q.freeCount} gratis` : "";
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
