// Electronics matching — IDENTIFIER-first, deliberately NOT the grocery matcher.
//
// Grocery matching is hard because "lapte 1,5% 1L" is a description, not an identifier, so
// it needs head-nouns, overlap scores and variant markers. Electronics is the opposite:
// EAN and MPN/model numbers are exact. Reusing the grocery name-overlap matcher here would
// import all of its difficulty and none of its necessity — and would happily merge a
// "Galaxy S24" with a "Galaxy S24 Ultra", which differ by one high-signal token.
//
// Order: EAN → MPN/model → name similarity as a TIEBREAKER only, never as a primary key.

import { parseEan } from "../product/ean";
import { normalizeRo, overlapTokensRo, jaccard } from "../text/normalizeRo";

export type ElectronicsItem = {
  name: string;
  brand?: string | null;
  ean?: string | null;
  mpn?: string | null;
  model?: string | null;
};

export type ElectronicsMatch = {
  ok: boolean;
  confidence: number;
  reason: "EAN_EXACT" | "MPN_EXACT" | "MODEL_EXACT" | "NAME_TIEBREAK" | "NO_MATCH";
};

/**
 * Normalise a manufacturer part number for comparison.
 * Vendors punctuate the same MPN differently ("SM-S921BZKD", "SM S921BZKD", "sms921bzkd"),
 * so compare on alphanumerics only — but keep them, because that string IS the product.
 */
export function normalizeMpn(raw: string | null | undefined): string {
  if (!raw) return "";
  const s = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, "");
  // Two characters is not an identifier, it is noise.
  return s.length >= 4 ? s : "";
}

/** Name similarity, used ONLY to break a tie between identifier-equal candidates. */
function nameSimilarity(a: string, b: string): number {
  return jaccard(new Set(overlapTokensRo(a)), new Set(overlapTokensRo(b)));
}

/** Minimum similarity for the tiebreaker to accept anything at all. */
const NAME_TIEBREAK_THRESHOLD = 0.8;

/**
 * Match one feed item against one catalog item.
 *
 * Note what is NOT here: no head-noun rule, no variant-marker list, no 0.55 overlap floor.
 * If two electronics products share an EAN they are the same product, full stop; if they
 * share nothing but a name, we do not guess.
 */
export function matchElectronics(a: ElectronicsItem, b: ElectronicsItem): ElectronicsMatch {
  const eanA = parseEan(a.ean);
  const eanB = parseEan(b.ean);
  if (eanA && eanB) {
    // A checksum-valid GTIN on both sides is definitive — in either direction.
    return eanA === eanB
      ? { ok: true, confidence: 1, reason: "EAN_EXACT" }
      : { ok: false, confidence: 0, reason: "NO_MATCH" };
  }

  const mpnA = normalizeMpn(a.mpn);
  const mpnB = normalizeMpn(b.mpn);
  if (mpnA && mpnB && mpnA === mpnB) return { ok: true, confidence: 0.97, reason: "MPN_EXACT" };

  const modelA = normalizeMpn(a.model);
  const modelB = normalizeMpn(b.model);
  if (modelA && modelB && modelA === modelB) return { ok: true, confidence: 0.95, reason: "MODEL_EXACT" };

  // No identifier on either side. Fall back to a STRICT name comparison, and require the
  // brand to agree — "Galaxy S24" and "Galaxy S24 Ultra" must not merge.
  const brandA = normalizeRo(a.brand ?? "");
  const brandB = normalizeRo(b.brand ?? "");
  if (brandA && brandB && brandA !== brandB) return { ok: false, confidence: 0, reason: "NO_MATCH" };
  const sim = nameSimilarity(a.name, b.name);
  if (sim >= NAME_TIEBREAK_THRESHOLD) return { ok: true, confidence: 0.6 + 0.3 * sim, reason: "NAME_TIEBREAK" };
  return { ok: false, confidence: sim, reason: "NO_MATCH" };
}

/** Pull structured specs out of an electronics title, for filtering. */
export function extractSpecs(name: string): { key: string; value: string; unit?: string }[] {
  const out: { key: string; value: string; unit?: string }[] = [];
  const n = name.replace(/\s+/g, " ");
  const screen = n.match(/(\d{1,2}(?:[.,]\d)?)\s*(?:inch|"|''|țoli|toli)/i);
  if (screen) out.push({ key: "screenSize", value: screen[1].replace(",", "."), unit: "inch" });
  const ram = n.match(/(\d{1,3})\s*GB\s*(?:RAM|memorie)/i);
  if (ram) out.push({ key: "ram", value: ram[1], unit: "GB" });
  const storage = n.match(/(\d{2,4})\s*(GB|TB)\b(?!\s*RAM)/i);
  if (storage) out.push({ key: "storage", value: storage[1], unit: storage[2].toUpperCase() });
  const cpu = n.match(/\b(i[3579]|Ryzen\s*\d|Snapdragon\s*\d+|M[1-4](?:\s*Pro|\s*Max)?)\b/i);
  if (cpu) out.push({ key: "cpu", value: cpu[1].replace(/\s+/g, " ") });
  const capacity = n.match(/(\d{3,5})\s*mAh/i);
  if (capacity) out.push({ key: "battery", value: capacity[1], unit: "mAh" });
  return out;
}
