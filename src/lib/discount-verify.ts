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
  /** how many of our own recorded points fall inside the window */
  ourObservations: number;
  /** how many days we have actually watched this offer — the real confidence signal */
  coverageDays: number;
  /** the window the copy may honestly name: 30 with a retailer figure, our span without one */
  windowDays: number;
  /** whose number the verdict rests on. Never hide this — the page must show its working. */
  baselineSource: "RETAILER" | "OUR_HISTORY" | "NONE";
  /** the real saving against the 30-day minimum, in bani (0 when there is none) */
  realSavingBani: Bani;
  /** the saving the shopper is led to expect from the struck price */
  advertisedSavingBani: Bani;
  /** set when the retailer's stated 30-day minimum and ours disagree materially */
  disagreesWithOurHistory: boolean;
  /**
   * The stored "was" price is not above the current price, so it cannot be a former price.
   *
   * Live example, Kaufland offer #69379 (`Măsline verzi 100 G`): now 15,90 · was 7,49 ·
   * reference 26,50 — three mutually incoherent numbers. Publishing any verdict from that row
   * would state something false about a named retailer, and the fault is ours, not theirs.
   * Rows like this are withheld and queued, never rendered.
   */
  advertisedWasIsIncoherent: boolean;
  /** true when a human should look before this is published */
  needsReview: boolean;
};

/** Our own history disagreeing with the retailer's figure by more than this is notable. */
const DISAGREEMENT_TOLERANCE_BP = 500; // 5%
/**
 * Below this many days of ACTUAL OBSERVATION our own floor is not evidence of anything.
 *
 * This used to be a count of recorded points, and that was backwards — see `priorMinimum`.
 */
export const MIN_COVERAGE_DAYS = 14;

export type HistoryPoint = { priceBani: Bani; recordedAt: Date };

export type BaselineWindow = {
  /** the lowest price in force during the window, BEFORE the current price took effect */
  minBani: Bani | null;
  /** how many recorded points fall inside the window */
  count: number;
  /** true when the price at the window's start came from a point recorded BEFORE it */
  carriedIn: boolean;
  /** how many days we have actually been watching this offer, capped at the window */
  coverageDays: number;
};

/**
 * The lowest price in force during the window, excluding the current price's own run.
 *
 * ── THREE THINGS THE OBVIOUS VERSION GETS WRONG, each measured on this database.
 *
 * 1. **PriceHistory appends ON CHANGE ONLY** (CLAUDE.md, "Scraping"). So the number of rows
 *    inside a window measures how often the price MOVED, not how well we know it. 6,663 live
 *    offers hold a price that was recorded before the window and never changed inside it: we
 *    know those perfectly, and filtering to `recordedAt >= cutoff` returned NOTHING for every
 *    one of them. Meanwhile a price that thrashed three times looked well-evidenced. The
 *    confidence signal was inverted, so the fix is to carry the price INTO the window and to
 *    gate on `coverageDays` — how long we have watched — instead of on a row count.
 *
 * 2. **Today's price is not part of its own baseline.** A genuine cut is recorded as a new
 *    point immediately, so a plain minimum over the window includes the reduced price itself
 *    and `current < min` can never be true. Every real reduction we observed would have been
 *    published as "Preț revenit la minimul recent" — telling a shopper a true discount is
 *    fake, about a named retailer. That is the worst direction this page can be wrong in.
 *    So the window ends where the current price's run begins.
 *
 * 3. **A price that went UP is invisible** without the carried-in value: history of 5,00 at
 *    day 60 and 9,00 at day 5 has a real 30-day floor of 5,00, and the naive filter reports
 *    9,00 — the current price, which then trivially "matches its floor".
 */
export function priorMinimum(
  history: HistoryPoint[],
  currentBani: Bani,
  days = 30,
  now = new Date(),
): BaselineWindow {
  const nowMs = now.getTime();
  const cutoff = nowMs - days * 864e5;
  const sorted = [...history].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
  if (sorted.length === 0) return { minBani: null, count: 0, carriedIn: false, coverageDays: 0 };

  const coverageDays = Math.min(days, Math.max(0, (nowMs - sorted[0].recordedAt.getTime()) / 864e5));

  // When did today's price take effect? Walk back over the trailing run already carrying it.
  let startOfCurrent = nowMs;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].priceBani !== currentBani) break;
    startOfCurrent = sorted[i].recordedAt.getTime();
  }

  // The price in force AT the window's start: the last point strictly before it.
  let carried: Bani | null = null;
  for (const h of sorted) {
    if (h.recordedAt.getTime() < cutoff) carried = h.priceBani;
    else break;
  }

  const inWindow = sorted.filter(
    (h) => h.recordedAt.getTime() >= cutoff && h.recordedAt.getTime() < startOfCurrent,
  );
  const candidates = inWindow.map((h) => h.priceBani);
  if (carried != null) candidates.push(carried);

  return {
    minBani: candidates.length > 0 ? Math.min(...candidates) : null,
    count: inWindow.length,
    carriedIn: carried != null,
    coverageDays: Math.round(coverageDays * 10) / 10,
  };
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
  const { minBani: ourMin, count, coverageDays } = priorMinimum(input.history ?? [], input.currentBani, 30, now);
  const advertisedSavingBani =
    input.advertisedWasBani && input.advertisedWasBani > input.currentBani
      ? input.advertisedWasBani - input.currentBani
      : 0;

  const advertisedWasIsIncoherent =
    input.advertisedWasBani != null && input.advertisedWasBani <= input.currentBani;

  const ourFloorIsEvidence = coverageDays >= MIN_COVERAGE_DAYS && ourMin != null;

  // Prefer the retailer's own sworn figure; fall back to ours only when it is well-evidenced.
  const baseline = input.omnibus30dBani ?? (ourFloorIsEvidence ? ourMin : null);

  // ── THE WINDOW WE NAME MUST BE THE WINDOW WE HAVE.
  // The retailer's Omnibus figure is a sworn 30-day number. Ours is worth exactly as many days
  // as we have watched, and this database's oldest observation is 34 days old — so for most
  // offers a "30 de zile" claim built on our history would be a claim we cannot support. The
  // copy states the real span instead of the legal one.
  const windowDays = input.omnibus30dBani != null ? 30 : Math.floor(coverageDays);

  const disagreesWithOurHistory =
    input.omnibus30dBani != null && ourFloorIsEvidence
      ? Math.abs(input.omnibus30dBani - ourMin!) > (ourMin! * DISAGREEMENT_TOLERANCE_BP) / 10000
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
    coverageDays,
    windowDays,
    baselineSource: input.omnibus30dBani != null ? "RETAILER" : ourFloorIsEvidence ? "OUR_HISTORY" : "NONE",
    realSavingBani,
    advertisedSavingBani,
    disagreesWithOurHistory,
    advertisedWasIsIncoherent,
    // A disagreement with the retailer's own figure, or a "was" price that cannot be one, are
    // exactly the cases a human should see before we publish anything about them.
    needsReview: disagreesWithOurHistory || advertisedWasIsIncoherent,
  };
}

/**
 * Romanian copy. States what the numbers show; makes no accusation.
 *
 * `windowDays` defaults to 30 — the legal Omnibus window — because that is right whenever the
 * retailer's own figure is the baseline. When OUR history is the baseline it must be passed,
 * so the label cannot claim thirty days of evidence we do not have.
 */
export function verdictLabel(v: DiscountVerdict, windowDays = 30): { label: string; tone: "good" | "neutral" | "warn" } {
  switch (v) {
    case "REDUCERE_REALA":
      return { label: "Reducere reală", tone: "good" };
    case "REDUCERE_MICA":
      return { label: "Preț revenit la minimul recent", tone: "neutral" };
    case "FARA_REDUCERE":
      return { label: `Fără reducere față de ultimele ${windowDays} de zile`, tone: "warn" };
    default:
      return { label: "Date insuficiente", tone: "neutral" };
  }
}

/**
 * One-sentence explanation built from the evidence, in Romanian.
 *
 * Every sentence names WHOSE number it rests on. "Magazinul declară" and "noi am observat" are
 * different claims with different standing, and collapsing them into one confident voice is how
 * a page like this ends up asserting something it cannot support about a named retailer.
 */
export function verdictExplanation(e: DiscountEvidence): string {
  const lei = (b: Bani) => `${(b / 100).toFixed(2).replace(".", ",")} lei`;
  const floor = (e.omnibus30dBani ?? e.ourMin30dBani)!;
  const src =
    e.baselineSource === "RETAILER"
      ? `minimul pe ultimele 30 de zile declarat de magazin (${lei(floor)})`
      : `cel mai mic preț pe care l-am observat noi în ultimele ${e.windowDays} de zile (${lei(floor)})`;

  switch (e.verdict) {
    case "REDUCERE_REALA":
      return `Prețul de acum, ${lei(e.currentBani)}, este sub ${src}. Diferența este ${lei(e.realSavingBani)}.`;
    case "REDUCERE_MICA":
      return `Prețul tăiat sugerează ${lei(e.advertisedSavingBani)} reducere. Față de ${src}, prețul de acum nu coboară sub el.`;
    case "FARA_REDUCERE":
      return `Prețul de acum nu este mai mic decât ${src}.`;
    default:
      return "Nu am urmărit acest preț destul timp cât să verificăm reducerea.";
  }
}
