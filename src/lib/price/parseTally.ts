// Null observability for price parsing.
//
// `parsePrice` returning null is the honest answer to "I can't read this" — but a scraper
// that quietly drops 40% of its items looks EXACTLY like a scraper that legitimately found
// fewer products. That is how a selector regression hides for weeks. So every run counts
// its nulls, keeps samples of what it couldn't read, and raises when the rate is high
// enough that the run should not be trusted.

/** Above this share of unparseable prices, a run is not trustworthy. */
export const NULL_RATE_THRESHOLD = 0.05; // 5%

/**
 * Above this share of items reported UNAVAILABLE, a run is not trustworthy either.
 *
 * An item a store marks out of stock legitimately carries no price — VTEX writes Price: 0,
 * and Auchan does that for 17.3% of its catalog. Counting those as parse failures makes the
 * 5% tripwire fire on a healthy run. But simply exempting them opens the exact hole the
 * tripwire exists to close: a field-map break that reads availability as false everywhere
 * would make every price legitimately absent, and the run would pass silently.
 *
 * So unavailable items are counted separately AND bounded. A store with two thirds of its
 * catalog out of stock is not a store, it is a broken read.
 */
export const UNAVAILABLE_RATE_THRESHOLD = 0.6; // 60%

const MAX_SAMPLES = 20;

export type TallySummary = {
  label: string;
  attempted: number;
  parsed: number;
  nulls: number;
  /** nulls / attempted, 0 when nothing was attempted */
  nullRate: number;
  /** up to 20 of the raw inputs that failed to parse */
  samples: string[];
  exceedsThreshold: boolean;
  /** items the store itself marked unavailable, which legitimately carry no price */
  unavailable: number;
  /** unavailable / (attempted + unavailable) */
  unavailableRate: number;
  /** true when so much is "unavailable" that the availability read is the suspect */
  unavailableExceedsThreshold: boolean;
};

/** Counts parse outcomes for one scraper run. */
export class ParseTally {
  readonly label: string;
  private attempted = 0;
  private nulls = 0;
  private samples: string[] = [];
  private unavailable = 0;

  constructor(label: string) {
    this.label = label;
  }

  /**
   * Record one parse attempt.
   * @returns the value unchanged, so callers can wrap inline:
   *          `const p = tally.record(raw, parsePriceLei(raw));`
   */
  record<T>(raw: string | null | undefined, value: T | null): T | null {
    this.attempted++;
    if (value == null) {
      this.nulls++;
      if (this.samples.length < MAX_SAMPLES) {
        const s = String(raw ?? "").replace(/\s+/g, " ").trim();
        this.samples.push(s.length > 120 ? s.slice(0, 120) + "…" : s || "(empty)");
      }
    }
    return value;
  }

  /**
   * Record an item the store marked unavailable and therefore priced at 0 / not at all.
   *
   * NOT a parse attempt: the price is absent by design, not unreadable. Call this INSTEAD of
   * `record` and only when the store's own availability field says so — never as a fallback
   * for a price that failed to parse, which would launder every parse failure into a
   * legitimate skip and disable the tripwire completely.
   */
  recordUnavailable(): void {
    this.unavailable++;
  }

  get summary(): TallySummary {
    const parsed = this.attempted - this.nulls;
    const nullRate = this.attempted === 0 ? 0 : this.nulls / this.attempted;
    const seen = this.attempted + this.unavailable;
    return {
      label: this.label,
      attempted: this.attempted,
      parsed,
      nulls: this.nulls,
      nullRate,
      samples: [...this.samples],
      // a handful of nulls in a tiny run is noise, not a signal
      exceedsThreshold: this.attempted >= 20 && nullRate > NULL_RATE_THRESHOLD,
      unavailable: this.unavailable,
      unavailableRate: seen === 0 ? 0 : this.unavailable / seen,
      unavailableExceedsThreshold: seen >= 20 && this.unavailable / seen > UNAVAILABLE_RATE_THRESHOLD,
    };
  }

  /** Print the run summary. Always call this, even on a clean run. */
  report(): TallySummary {
    const s = this.summary;
    const pct = (s.nullRate * 100).toFixed(1);
    console.log(
      `\n[parse] ${s.label}: ${s.parsed}/${s.attempted} prices parsed, ${s.nulls} null (${pct}%)`,
    );
    if (s.unavailable > 0) {
      console.log(
        `[parse] ${s.label}: ${s.unavailable} items the store marked unavailable ` +
        `(${(s.unavailableRate * 100).toFixed(1)}% of ${s.attempted + s.unavailable} seen) — ` +
        `no price expected, not counted as a parse failure`,
      );
    }
    if (s.nulls > 0) {
      console.log(`[parse] sample unparseable inputs (max ${MAX_SAMPLES}):`);
      for (const x of s.samples) console.log(`          "${x}"`);
    }
    if (s.exceedsThreshold) {
      console.error(
        `[parse] ⚠ NULL RATE ${pct}% EXCEEDS ${(NULL_RATE_THRESHOLD * 100).toFixed(0)}% — ` +
          `this run is not trustworthy (selector drift or a page redesign).`,
      );
    }
    if (s.unavailableExceedsThreshold) {
      console.error(
        `[parse] ⚠ UNAVAILABLE RATE ${(s.unavailableRate * 100).toFixed(1)}% EXCEEDS ` +
          `${(UNAVAILABLE_RATE_THRESHOLD * 100).toFixed(0)}% — the availability field is the suspect, ` +
          `not the shop. A field map that reads "unavailable" everywhere hides every missing price.`,
      );
    }
    return s;
  }

  /**
   * Report, then throw when the null rate is above the threshold.
   * Use in scrapers so a bad run fails loudly instead of writing thin data.
   */
  reportAndRaise(): TallySummary {
    const s = this.report();
    if (s.exceedsThreshold) {
      throw new Error(
        `${s.label}: ${s.nulls}/${s.attempted} prices unparseable ` +
          `(${(s.nullRate * 100).toFixed(1)}% > ${(NULL_RATE_THRESHOLD * 100).toFixed(0)}%). ` +
          `First sample: "${s.samples[0] ?? ""}"`,
      );
    }
    if (s.unavailableExceedsThreshold) {
      throw new Error(
        `${s.label}: ${s.unavailable}/${s.attempted + s.unavailable} items reported unavailable ` +
          `(${(s.unavailableRate * 100).toFixed(1)}% > ${(UNAVAILABLE_RATE_THRESHOLD * 100).toFixed(0)}%). ` +
          `Check the availability field before trusting this run.`,
      );
    }
    return s;
  }
}
