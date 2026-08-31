// "Reducere reală sau reducere de vitrină?" — verifying advertised discounts.
//
// Romanian retailers are legally required (EU Omnibus, transposed into OUG 34/2014) to print
// the LOWEST price of the previous 30 days whenever they announce a reduction. We capture
// that figure as `referencePriceBani` with kind OMNIBUS_30D. Comparing the advertised
// "discount" against it is what separates a real cut from a repriced sticker.
//
// TONE RULE, and it is not optional: this module states what the numbers show and nothing
// more. It never says a retailer lied. A retailer can raise a price legitimately, our own
// history can be incomplete, and a single mis-scrape must not become an accusation. Every
// classification carries the evidence that produced it so the UI can show its work.

import type { Bani } from "./price/parsePrice";

export type DiscountVerdict =
  /** the current price is genuinely below the 30-day minimum — a real cut */
  | "REDUCERE_REALA"
  /** below the struck price, but at or above the 30-day minimum — the "discount" only
   *  returns the price to where it recently was */
  | "REDUCERE_MICA"
  /** no reduction at all: price unchanged or higher than it has been */
  | "FARA_REDUCERE"
  /** not enough evidence to judge — say so rather than guess */
  | "NECUNOSCUT";

export type DiscountEvidence = {
  verdict: DiscountVerdict;
  currentBani: Bani;
  /** the retailer's own advertised "was" price, if any */
  advertisedWasBani?: Bani | null;
  /** the retailer's own stated 30-day minimum (Omnibus) */
  omnibus30dBani?: Bani | null;
  /** the 30-day minimum WE observed, independently */
  ourMin30dBani?: Bani | null;
  /** how many of our own observations back `ourMin30dBani` */
  ourObservations: number;
  /** the real saving against the 30-day minimum, in bani (0 when there is none) */
  realSavingBani: Bani;
  /** the saving the shopper is led to expect from the struck price */
  advertisedSavingBani: Bani;
  /** set when the retailer's stated 30-day minimum and ours disagree materially */
  disagreesWithOurHistory: boolean;
  /** true when a human should look before this is published */
  needsReview: boolean;
};

/** Our own history disagreeing with the retailer's figure by more than this is notable. */
const DISAGREEMENT_TOLERANCE_BP = 500; // 5%
/** Below this many observations our 30-day minimum is not evidence of anything. */
const MIN_OBSERVATIONS = 3;

export type HistoryPoint = { priceBani: Bani; recordedAt: Date };

/** The lowest price we ourselves recorded in the window. */
export function ourMinimum(history: HistoryPoint[], days = 30, now = new Date()): { minBani: Bani | null; count: number } {
  const cutoff = now.getTime() - days * 864e5;
  const inWindow = history.filter((h) => h.recordedAt.getTime() >= cutoff);
  if (inWindow.length === 0) return { minBani: null, count: 0 };
  return { minBani: Math.min(...inWindow.map((h) => h.priceBani)), count: inWindow.length };
}

/**
 * Classify an advertised reduction.
 *
 * Deliberately conservative: without an Omnibus figure AND without enough of our own
 * history, the verdict is NECUNOSCUT. Silence is the honest output when the evidence
 * isn't there.
 */
export function verifyDiscount(input: {
  currentBani: Bani;
  advertisedWasBani?: Bani | null;
  omnibus30dBani?: Bani | null;
  history?: HistoryPoint[];
  now?: Date;
}): DiscountEvidence {
  const now = input.now ?? new Date();
  const { minBani: ourMin, count } = ourMinimum(input.history ?? [], 30, now);
  const advertisedSavingBani =
    input.advertisedWasBani && input.advertisedWasBani > input.currentBani
      ? input.advertisedWasBani - input.currentBani
      : 0;

  // Prefer the retailer's own sworn figure; fall back to ours only when it is well-evidenced.
  const baseline =
    input.omnibus30dBani ?? (count >= MIN_OBSERVATIONS ? ourMin : null);

  const disagreesWithOurHistory =
    input.omnibus30dBani != null && ourMin != null && count >= MIN_OBSERVATIONS
      ? Math.abs(input.omnibus30dBani - ourMin) > (ourMin * DISAGREEMENT_TOLERANCE_BP) / 10000
      : false;

  let verdict: DiscountVerdict;
  let realSavingBani = 0;

  if (baseline == null) {
    verdict = "NECUNOSCUT";
  } else if (input.currentBani < baseline) {
    verdict = "REDUCERE_REALA";
    realSavingBani = baseline - input.currentBani;
  } else if (advertisedSavingBani > 0) {
    // struck price exists, but the current price is not below the 30-day floor
    verdict = "REDUCERE_MICA";
  } else {
    verdict = "FARA_REDUCERE";
  }

  return {
    verdict,
    currentBani: input.currentBani,
    advertisedWasBani: input.advertisedWasBani ?? null,
    omnibus30dBani: input.omnibus30dBani ?? null,
    ourMin30dBani: ourMin,
    ourObservations: count,
    realSavingBani,
    advertisedSavingBani,
    disagreesWithOurHistory,
    // A disagreement with the retailer's own figure is exactly the case a human should see
    // before we publish anything about it.
    needsReview: disagreesWithOurHistory,
  };
}

/** Romanian copy. States what the numbers show; makes no accusation. */
export function verdictLabel(v: DiscountVerdict): { label: string; tone: "good" | "neutral" | "warn" } {
  switch (v) {
    case "REDUCERE_REALA":
      return { label: "Reducere reală", tone: "good" };
    case "REDUCERE_MICA":
      return { label: "Preț revenit la minimul recent", tone: "neutral" };
    case "FARA_REDUCERE":
      return { label: "Fără reducere față de ultimele 30 de zile", tone: "warn" };
    default:
      return { label: "Date insuficiente", tone: "neutral" };
  }
}

/** One-sentence explanation built from the evidence, in Romanian. */
export function verdictExplanation(e: DiscountEvidence): string {
  const lei = (b: Bani) => `${(b / 100).toFixed(2).replace(".", ",")} lei`;
  switch (e.verdict) {
    case "REDUCERE_REALA":
      return `Prețul de acum (${lei(e.currentBani)}) este sub minimul ultimelor 30 de zile (${lei(
        (e.omnibus30dBani ?? e.ourMin30dBani)!,
      )}). Economisești ${lei(e.realSavingBani)} față de acel minim.`;
    case "REDUCERE_MICA":
      return `Prețul tăiat sugerează ${lei(e.advertisedSavingBani)} reducere, dar minimul ultimelor 30 de zile a fost ${lei(
        (e.omnibus30dBani ?? e.ourMin30dBani)!,
      )} — prețul de acum nu coboară sub el.`;
    case "FARA_REDUCERE":
      return `Prețul de acum nu este mai mic decât minimul ultimelor 30 de zile (${lei(
        (e.omnibus30dBani ?? e.ourMin30dBani)!,
      )}).`;
    default:
      return "Nu avem încă destule observații ca să verificăm această reducere.";
  }
}
