// Bon fiscal (receipt) parsing — the only way to get TRUE shelf prices at physical stores
// at scale, and a moat nobody can scrape their way past: these are prices people actually
// paid, at a specific store, on a specific date.
//
// The OCR step is pluggable. `parseReceiptText` below is pure and tested — it takes the
// text of a Romanian fiscal receipt and returns structured lines. Whatever produces that
// text (a vision model, Tesseract, or a user pasting it) plugs into the same parser.
//
// Romanian receipt anatomy this handles:
//   S.C. KAUFLAND ROMANIA SCS         ← merchant line
//   LAPTE ZUZU 1.5% 1L      1 x 6,49       6,49 B
//   PAINE FELIATA 500G                     4,99 A
//   PUNGA                   2 x 0,50       1,00 B
//   TOTAL                                 12,48
// Amounts use RO decimal commas; the trailing letter is the VAT class.

import { parsePriceLei } from "./price/parsePrice";

export type ReceiptLine = {
  /** raw product text as printed */
  name: string;
  qty: number;
  /** price for ONE unit (lineTotal / qty) */
  unitPrice: number;
  lineTotal: number;
};

export type ParsedReceipt = {
  merchant: string | null;
  date: Date | null;
  lines: ReceiptLine[];
  total: number | null;
  /** lines the parser saw but could not interpret — useful for improving it */
  skipped: string[];
};

// Known chains, matched case-insensitively against the receipt header.
const MERCHANTS: { pattern: RegExp; slug: string }[] = [
  { pattern: /kaufland/i, slug: "kaufland" },
  { pattern: /lidl/i, slug: "lidl" },
  { pattern: /carrefour/i, slug: "carrefour" },
  { pattern: /auchan/i, slug: "auchan" },
  { pattern: /mega\s*image/i, slug: "mega-image" },
  { pattern: /profi/i, slug: "profi" },
  { pattern: /penny/i, slug: "penny" },
  { pattern: /selgros/i, slug: "selgros" },
  { pattern: /metro/i, slug: "metro" },
];

/** Non-product lines that must never become "products". */
const NOISE = /^(total|subtotal|tva|rest|numerar|card|bon|cif|c\.i\.f|cui|nr\.|casa|casier|data|ora|s\.?c\.?|str\.|adresa|magazin|client|puncte|discount|reducere|vanzare|cod fiscal|multumim|va multumim|serie|www\.|tel)/i;

// A receipt is just another price surface, so its amounts go through the ONE parser too —
// same RO decimal commas and grouped thousands, same "null means I don't know" contract.
const num = (s: string): number => parsePriceLei(s) ?? NaN;

export function detectMerchant(text: string): string | null {
  for (const m of MERCHANTS) if (m.pattern.test(text)) return m.slug;
  return null;
}

export function detectDate(text: string): Date | null {
  // A receipt date is a CALENDAR date, so build it in UTC. Using local midnight makes
  // toISOString() report the previous day in Romania (UTC+2/+3) — an off-by-one that would
  // file every purchase under the wrong day.
  const dmy = text.match(/\b(\d{2})[.\-\/](\d{2})[.\-\/](\d{4})\b/);
  if (dmy) {
    const d = new Date(Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])));
    if (!Number.isNaN(d.getTime())) return d;
  }
  const ymd = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (ymd) {
    const d = new Date(Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3])));
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

/** Parse the text of a Romanian fiscal receipt into structured lines. */
export function parseReceiptText(text: string): ParsedReceipt {
  const rawLines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const lines: ReceiptLine[] = [];
  const skipped: string[] = [];
  let total: number | null = null;

  for (const line of rawLines) {
    // TOTAL is captured separately (and must not become a product)
    const tm = line.match(/^total\b[^0-9]*([\d.,]+)/i);
    if (tm) { const v = num(tm[1]); if (Number.isFinite(v)) total = v; continue; }
    if (NOISE.test(line)) { continue; }

    // Form A: "NAME   2 x 6,49   12,98 B"  (explicit quantity)
    const withQty = line.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)\s*[xX*]\s*([\d.,]+)\s+([\d.,]+)\s*[A-D]?$/);
    if (withQty) {
      const qty = num(withQty[2]);
      const unitPrice = num(withQty[3]);
      const lineTotal = num(withQty[4]);
      const name = withQty[1].trim();
      if (name && qty > 0 && unitPrice > 0 && Number.isFinite(lineTotal)) {
        lines.push({ name, qty, unitPrice, lineTotal });
        continue;
      }
    }

    // Form B: "NAME   2 x 6,49"  (no line total printed)
    const qtyOnly = line.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)\s*[xX*]\s*([\d.,]+)\s*[A-D]?$/);
    if (qtyOnly) {
      const qty = num(qtyOnly[2]);
      const unitPrice = num(qtyOnly[3]);
      const name = qtyOnly[1].trim();
      if (name && qty > 0 && unitPrice > 0) {
        lines.push({ name, qty, unitPrice, lineTotal: +(qty * unitPrice).toFixed(2) });
        continue;
      }
    }

    // Form C: "NAME     4,99 A"  (single item, price at end, optional VAT class)
    const simple = line.match(/^(.+?)\s+([\d.,]+)\s*[A-D]?$/);
    if (simple) {
      const price = num(simple[2]);
      const name = simple[1].trim();
      // require a real product name (letters, not just a code) and a plausible price
      if (name && /[a-zăâîșț]{3,}/i.test(name) && price > 0 && price < 10000) {
        lines.push({ name, qty: 1, unitPrice: price, lineTotal: price });
        continue;
      }
    }

    skipped.push(line);
  }

  return { merchant: detectMerchant(text), date: detectDate(text), lines, total, skipped };
}

/** Sanity check: do the parsed lines add up to the printed total? */
export function receiptBalances(r: ParsedReceipt, tolerance = 0.05): boolean | null {
  if (r.total == null || r.lines.length === 0) return null;
  const sum = r.lines.reduce((a, l) => a + l.lineTotal, 0);
  return Math.abs(sum - r.total) <= Math.max(tolerance, r.total * 0.01);
}
