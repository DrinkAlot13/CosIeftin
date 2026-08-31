// THE single place a scraped string becomes money. Never call parseFloat on a price
// anywhere else (see CLAUDE.md → Prices).
//
// Contract:
//   • returns an INTEGER number of BANI, or null
//   • NEVER returns 0 — a zero-ish parse is ambiguity, and ambiguity must be null so the
//     caller is forced to handle "I don't know" instead of silently publishing a free item
//   • null on anything ambiguous: no digits, no plausible amount, or several DIFFERENT
//     candidate amounts with no currency marker to disambiguate them
//
// Four traps this must survive (each shipped as a production bug — see CLAUDE.md):
//   1. US comma-thousands   "2,033.39"                    → parseFloat gave 2 lei
//   2. Promo validity dates "de mi 26.08.2026 până ma …"  → "26.08" read as a price
//   3. 30-day reference     "preț minim … 30 de zile: 7,99 LEI" → EU Omnibus prints this
//                                                            on EVERY RO retailer
//   4. Footnote markers     "11,99 LEI1"                  → min-of-all-numbers picked "1"

/** Money is always an integer number of bani. */
export type Bani = number;

// ── things that are NOT the price, stripped before any numeric scan ────────────────
// dd.mm.yyyy / dd-mm-yyyy / dd/mm/yyyy / yyyy-mm-dd
const DATE = /\b\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/g;
// "preț minim în ultimele 30 de zile: 7,99 lei" — the EU Omnibus reference price. It is
// NOT what you pay, so it must never win the current-price answer — but it IS genuinely
// useful data (the retailer's own sworn 30-day low), so we CAPTURE it rather than merely
// discard it. Non-greedy up to the FIRST currency-suffixed amount, so the "30" in the
// phrase itself does not end the match early.
const REFERENCE_PRICE = /pre[tțţ]\s*minim.{0,60}?([\d.,    ]+)\s*(?:lei|ron)/gi;
// The same legal duty, worded differently by different chains.
const REFERENCE_ALT = /(?:cel\s*mai\s*mic\s*pre[tțţ]|pre[tțţ]\s*anterior|ultimele\s*30\s*(?:de\s*)?zile)[^0-9]{0,40}([\d.,    ]+)\s*(?:lei|ron)/gi;
// A struck-through "was" price: <del>/<s>/<strike>, "preț vechi", "în loc de".
const STRIKETHROUGH = /(?:<\s*(?:del|s|strike)\b[^>]*>\s*|pre[tțţ]\s*vechi[^0-9]{0,12}|[iî]n\s*loc\s*de\s*)([\d.,    ]+)\s*(?:lei|ron)?/gi;
// per-unit prices ("12,99 lei/kg") are not the pack price
const PER_UNIT = /\/\s*(?:l|kg|g|ml|cl|buc|100\s*(?:g|ml))/i;
// every space Romanian retail uses as a thousands separator
const SPACEY = /[    ⁠]/g;

const CURRENCY = /(?:lei|ron)/i;

/** Sanity window for a single retail price, in bani: 1 ban … 1,000,000 lei. */
const MIN_BANI = 1;
const MAX_BANI = 100_000_000;

/** Round a lei amount to whole bani without float drift at the boundary. */
function leiToBani(lei: number): number | null {
  if (!Number.isFinite(lei)) return null;
  const bani = Math.round(lei * 100);
  if (!Number.isFinite(bani) || bani < MIN_BANI || bani > MAX_BANI) return null;
  return bani;
}

/**
 * Parse ONE numeric token that may carry ./,/space grouping into lei.
 * Exported for tests; prefer parsePrice everywhere else.
 */
export function parseDecimal(token: string): number | null {
  let s = token.replace(SPACEY, " ").replace(/[^\d.,\s]/g, "").trim();
  // space-grouped thousands: "2 033,39" / "1 234 567"
  if (/^\d{1,3}(?: \d{3})+(?:[.,]\d+)?$/.test(s)) s = s.replace(/ /g, "");
  s = s.replace(/\s/g, "");
  if (!/\d/.test(s)) return null;

  const hasDot = s.includes(".");
  const hasComma = s.includes(",");

  if (hasDot && hasComma) {
    // whichever separator comes LAST is the decimal point; the other is grouping
    const dec = s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : ".";
    const grp = dec === "," ? "." : ",";
    s = s.split(grp).join("").replace(dec, ".");
  } else if (hasComma) {
    const parts = s.split(",");
    const last = parts[parts.length - 1];
    // "2,033" (single comma, exactly 3 trailing) is thousands; "12,99" is decimal
    s = parts.length === 2 && last.length === 3 ? s.replace(",", "") : s.replace(/,/g, ".");
    if (parts.length > 2) s = parts.join(""); // "1,234,567"
  } else if (hasDot) {
    const parts = s.split(".");
    const last = parts[parts.length - 1];
    if (parts.length > 2) s = parts.join(""); // "1.234.567"
    else if (parts.length === 2 && last.length === 3) s = s.replace(".", ""); // "2.033"
  }

  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

export type ParseOptions = {
  /**
   * When a block shows several real prices (regular + promo), which one is "the price".
   * Default "lowest" — the promo is what a shopper pays today.
   */
  prefer?: "lowest" | "first";
};

/** Where a reference ("was"/"lowest") price came from. */
export type ReferencePriceKind = "OMNIBUS_30D" | "STRIKETHROUGH" | null;

/**
 * The full parse result.
 *
 * The reference price is the EU-Omnibus 30-day low (or a struck-through "was" price).
 * It must NEVER be quoted as the current price — but it is the retailer's own sworn
 * statement about recent pricing, which makes it the best available baseline for judging
 * whether a "promo" is real. So it is captured here rather than thrown away.
 */
export type PriceParse = {
  /** what a shopper pays today; null when ambiguous */
  priceBani: Bani | null;
  /** the advertised "was"/30-day-low price, when the page states one */
  referencePriceBani?: Bani;
  referencePriceKind?: ReferencePriceKind;
};

/** Pull a reference price out of the ORIGINAL text (before it gets stripped). */
function extractReference(s: string): { bani: Bani; kind: Exclude<ReferencePriceKind, null> } | null {
  for (const [re, kind] of [
    [REFERENCE_PRICE, "OMNIBUS_30D"],
    [REFERENCE_ALT, "OMNIBUS_30D"],
    [STRIKETHROUGH, "STRIKETHROUGH"],
  ] as const) {
    re.lastIndex = 0; // these are /g and module-level — reset before every use
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      const lei = parseDecimal(m[1]);
      if (lei == null) continue;
      const bani = leiToBani(lei);
      if (bani != null) return { bani, kind };
    }
  }
  return null;
}

/**
 * THE parser. Returns the current price plus any advertised reference price.
 * Every other price entry point is a thin wrapper over this one.
 */
export function parsePriceDetailed(raw: string | null | undefined, opts: ParseOptions = {}): PriceParse {
  const priceBani = scanCurrentPrice(raw, opts);
  if (raw == null) return { priceBani };
  const ref = extractReference(String(raw).replace(SPACEY, " "));
  if (!ref) return { priceBani };
  // The two kinds have OPPOSITE expectations, and conflating them loses real data:
  //   • STRIKETHROUGH is a "was" price, so it must be ABOVE the current price. One that
  //     isn't is a mis-parse, and publishing it would invent a fake discount.
  //   • OMNIBUS_30D is the LOWEST price of the last 30 days, so it is normally BELOW the
  //     current price. Requiring it to be higher discarded every legitimate one.
  if (ref.kind === "STRIKETHROUGH" && priceBani != null && ref.bani <= priceBani) {
    return { priceBani };
  }
  return { priceBani, referencePriceBani: ref.bani, referencePriceKind: ref.kind };
}

/**
 * Extract a pack price from arbitrary card text.
 * @returns whole bani, or null when the text carries no unambiguous price.
 */
/** Internal: the current-price scan. Callers use parsePriceDetailed (or the parsePrice
 *  wrapper). Kept private so there is exactly ONE public entry point that also captures
 *  reference prices — two entry points is the drift risk parsePriceLei had. */
function scanCurrentPrice(raw: string | null | undefined, opts: ParseOptions = {}): Bani | null {
  if (raw == null) return null;
  const prefer = opts.prefer ?? "lowest";

  // normalise exotic spaces, then remove the three things that masquerade as prices
  const s = String(raw)
    .replace(SPACEY, " ")
    .replace(DATE, " ")
    .replace(REFERENCE_PRICE, " ")
    .replace(REFERENCE_ALT, " ")
    // A struck-through price is BY DEFINITION not the current one, so remove it before
    // choosing. Without this it stayed in the candidate pool, and on any page where the
    // "was" price happens to sit BELOW the live price (a retailer error, or a mis-parse)
    // the prefer:"lowest" rule would quote the struck price as what you pay.
    .replace(STRIKETHROUGH, " ");
  if (!/\d/.test(s)) return null;

  const pick = (vals: number[]): Bani | null => {
    const bani = vals.map(leiToBani).filter((b): b is number => b != null);
    if (bani.length === 0) return null;
    return prefer === "lowest" ? Math.min(...bani) : bani[0];
  };

  // ── 1) RO split shelf price: "12 99 lei" (whole SPACE bani), as printed on price cards.
  //    The bani group must be EXACTLY two digits not followed by a separator, so
  //    space-grouped thousands ("2 033,39 lei") fall through to the rules below.
  const split: number[] = [];
  const splitRe = /(\d{1,5})\s+(\d{2})(?![\d.,])\s*(?:lei|ron)(?![a-z])/gi;
  let m: RegExpExecArray | null;
  while ((m = splitRe.exec(s))) {
    const tail = s.slice(m.index + m[0].length, m.index + m[0].length + 6);
    if (PER_UNIT.test(tail)) continue; // "12 99 lei/kg"
    const v = parseFloat(`${m[1]}.${m[2]}`);
    if (Number.isFinite(v)) split.push(v);
  }
  if (split.length) return pick(split);

  // ── 2) amounts ATTACHED to a currency word: "11,99 LEI", "2 033,39 lei".
  //    (?![a-z]) rather than \b — "11,99 LEI1" has no word boundary after "LEI".
  //    This beats scanning every digit in the block: it is what defeats footnote markers.
  const withCurrency: number[] = [];
  const curRe = /(\d[\d.,    ]*\d|\d)\s*(?:lei|ron)(?![a-z])/gi;
  while ((m = curRe.exec(s))) {
    const tail = s.slice(m.index + m[0].length, m.index + m[0].length + 6);
    if (PER_UNIT.test(tail)) continue;
    const v = parseDecimal(m[1]);
    if (v != null && v > 0) withCurrency.push(v);
  }
  if (withCurrency.length) return pick(withCurrency);

  // ── 3) no currency marker anywhere: a bare number is only unambiguous if the text
  //    yields exactly ONE distinct plausible amount (e.g. a data-price attribute).
  const cleaned = s.replace(new RegExp(PER_UNIT.source + "[^0-9]*[\\d.,]+", "gi"), " ");
  // A token may only span a space when that space is a THOUSANDS separator ("2 033,39").
  // Letting the general case span spaces made "6,49 6,49" parse as one 6.496.49 number.
  const bare = [...cleaned.matchAll(/\d{1,3}(?: \d{3})+(?:[.,]\d+)?|\d[\d.,]*\d|\d/g)]
    .map((x) => parseDecimal(x[0]))
    .filter((v): v is number => v != null && v > 0);
  if (bare.length === 0) return null;

  const distinct = [...new Set(bare.map((v) => leiToBani(v)).filter((b): b is number => b != null))];
  if (distinct.length === 0) return null;
  // Several DIFFERENT bare numbers and nothing to tell us which is the price → ambiguous.
  if (distinct.length > 1 && !CURRENCY.test(s)) return null;
  return prefer === "lowest" ? Math.min(...distinct) : distinct[0];
}

// ── presentation helpers (money math stays integer) ────────────────────────────────

/** Bani → lei, for display or for a float-typed legacy column. */
export function baniToLei(bani: Bani): number {
  return bani / 100;
}

/**
 * Parse to LEI instead of bani.
 *
 * TRANSITIONAL: the DB columns are still Float lei, so scrapers use this to route through
 * the one true parser today without waiting for the bani migration. Once money columns are
 * integer bani, callers move to `parsePrice` and this goes away.
 * Still returns null (never 0) on ambiguity — that contract does not soften.
 */
export function parsePriceLei(raw: string | null | undefined, opts: ParseOptions = {}): number | null {
  const bani = parsePriceDetailed(raw, opts).priceBani;
  return bani == null ? null : baniToLei(bani);
}

/** Lei → bani, for reading legacy float columns into integer math. */
/**
 * The largest value a 32-bit INT column holds. `Offer.pricePerUnitBani` is one of those, and
 * it is a DERIVED figure — price divided by a pack size — so a mis-parsed size can send it far
 * past this. A nicotine spray whose name states "1 mg" and nothing else divides an 86 lei price
 * by a millionth of a kilogram and asks the database to store 8,650,000,000. Prisma throws, and
 * a scraper mid-run dies on one bad product name.
 */
export const MAX_INT32 = 2147483647;

/**
 * Price per canonical unit, in bani — or null when it cannot honestly be stored.
 *
 * Null means "we could not compute this", which is true and harmless: the column is nullable
 * and the UI already handles a missing per-unit price. Clamping to MAX_INT32 instead would
 * store a number that is not the price, and every chart and sort would believe it.
 */
export function perUnitBaniOrNull(price: number, divisor: number): number | null {
  if (!(divisor > 0) || !Number.isFinite(price)) return null;
  const bani = Math.round((price / divisor) * 100);
  return Number.isFinite(bani) && bani >= 0 && bani <= MAX_INT32 ? bani : null;
}

export function leiToBaniExact(lei: number): Bani {
  return Math.round(lei * 100);
}

/** Romanian money formatting from integer bani: 203339 → "2.033,39 lei". */
export function formatBani(bani: Bani): string {
  const sign = bani < 0 ? "-" : "";
  const abs = Math.abs(bani);
  const lei = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, "0");
  const grouped = String(lei).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${grouped},${rest} lei`;
}

// ── the only public entry points, both thin wrappers over parsePriceDetailed ────────

/**
 * Current price only, in bani (or null).
 * A convenience wrapper over `parsePriceDetailed` — there is one parser, so a caller can
 * never accidentally use a path that silently drops reference prices.
 */
export function parsePrice(raw: string | null | undefined, opts: ParseOptions = {}): Bani | null {
  return parsePriceDetailed(raw, opts).priceBani;
}
