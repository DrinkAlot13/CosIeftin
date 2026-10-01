// Turning a machine-readable resolution into a Romanian sentence.
//
// `resolveLine` deliberately returns DATA and never prose — that is what makes it testable and
// what keeps the wording out of the engine. This module is the other half of that contract, and
// it is the ONLY place substitution copy is written. Two places writing the same sentence
// differently is how a shopper ends up reading "am ales" on one screen and "am înlocuit" on the
// next for the same event.
//
// The sentences follow one rule: SAY WHAT HAPPENED AND WHY, WITH THE NUMBER. "Am ales altceva"
// is not an explanation. "Nu am găsit Lapte Zuzu la Mega Image. Am ales Lapte Olympus — cu 2,30
// lei/L mai ieftin." is one, and it lets the shopper disagree.

import type { Resolution, ResolutionReason } from "./resolve";

/** Money, Romanian style: 2,30 lei. */
function lei(bani: number): string {
  return `${(bani / 100).toFixed(2).replace(".", ",")} lei`;
}

/** The unit a per-unit price is quoted in. */
export function unitWord(unit: string): string {
  const u = unit.toLowerCase();
  if (u === "kg" || u === "g") return "kg";
  if (u === "l" || u === "ml") return "L";
  return "buc";
}

export type Explanation = {
  /** One line, safe to show on its own. */
  headline: string;
  /** The reason, when there is one worth giving. */
  detail?: string;
  /** "cheaper"/"dearer"/neither — lets the UI colour it without re-deriving. */
  tone: "neutral" | "good" | "warn";
};

/**
 * Why this line resolved the way it did.
 *
 * `shopName` is required for the substitution cases: "nu am găsit X" without naming the shop is
 * a claim about the whole site, and it is usually false — the product exists, just not there.
 */
export function explainResolution(r: Resolution, shopName: string, unit: string): Explanation {
  const reason: ResolutionReason = r.reason;
  const u = unitWord(unit);
  const saving = reason.savingPerUnitBani;

  switch (reason.code) {
    case "EXACT_MATCH":
      return { headline: `Exact ce ai cerut, la ${shopName}.`, tone: "neutral" };

    case "SPLIT_PACKS":
      return {
        headline: `${reason.packs} pachete pentru cantitatea cerută.`,
        detail: `La ${shopName} produsul vine în pachet mai mic, așa că am pus ${reason.packs}.`,
        tone: "neutral",
      };

    case "SUBSTITUTED_EQUIVALENT":
    case "SUBSTITUTED_STRUCTURAL":
    case "SUBSTITUTED_CHEAPEST":
    case "SUBSTITUTED_SAME_BRAND": {
      const head = `Nu am găsit ${reason.requestedProductName ?? "produsul cerut"} la ${shopName}. Am ales ${reason.chosenProductName ?? "altceva"}`;
      // STRUCTURAL is a weaker claim than a curated class (see structural-equivalence.ts) —
      // say so, rather than let it read as equally certain as a human-confirmed equivalence.
      const caveat = reason.code === "SUBSTITUTED_STRUCTURAL" ? " ca produs similar" : "";
      if (saving != null && saving > 0) {
        return { headline: `${head}${caveat} — cu ${lei(saving)}/${u} mai ieftin.`, tone: "good" };
      }
      if (saving != null && saving < 0) {
        return { headline: `${head}${caveat} — cu ${lei(-saving)}/${u} mai scump.`, tone: "warn" };
      }
      return { headline: `${head}${caveat}.`, tone: "neutral" };
    }

    case "EXACT_ONLY_NOT_STOCKED":
      return {
        headline: `${reason.requestedProductName ?? "Produsul"} nu este la ${shopName}.`,
        detail: "Ai fixat acest produs exact, așa că nu am înlocuit nimic.",
        tone: "warn",
      };

    case "ALL_CANDIDATES_EXCLUDED": {
      const e = reason.excluded;
      const bits: string[] = [];
      if (e?.stale) bits.push(`${e.stale} fără stoc`);
      if (e?.expired) bits.push(`${e.expired} cu promoție expirată`);
      if (e?.blocked) bits.push(`${e.blocked} excluse de tine`);
      if (e?.anomaly) bits.push(`${e.anomaly} cu preț nesigur`);
      return {
        headline: `Nimic potrivit la ${shopName}.`,
        detail: bits.length ? `Am găsit produse, dar: ${bits.join(", ")}.` : undefined,
        tone: "warn",
      };
    }

    case "NOT_STOCKED":
    default:
      return { headline: `Nu se găsește la ${shopName}.`, tone: "warn" };
  }
}

/**
 * Why THIS product was picked for a recipe ingredient, at add time.
 *
 * Different question from the one above: nothing has been substituted yet, the shopper is being
 * told how we chose. Ranking order is the resolver's own — explicit favourite, inferred
 * favourite, private label when opted in, then cheapest per unit — so the wording enumerates
 * exactly those and nothing else.
 */
export type PickBasis = "FAVOURITE" | "INFERRED" | "PRIVATE_LABEL" | "CHEAPEST" | "ONLY_OPTION";

export function explainPick(basis: PickBasis, unitPriceBani: number | null, unit: string): string {
  const per = unitPriceBani != null ? ` (${lei(unitPriceBani)}/${unitWord(unit)})` : "";
  switch (basis) {
    case "FAVOURITE":   return `pentru că e la favorite${per}`;
    case "INFERRED":    return `pentru că îl cumperi des${per}`;
    case "PRIVATE_LABEL": return `marcă proprie, cum ai cerut${per}`;
    case "ONLY_OPTION": return `singurul disponibil${per}`;
    case "CHEAPEST":
    default:            return `cel mai ieftin pe unitate${per}`;
  }
}
