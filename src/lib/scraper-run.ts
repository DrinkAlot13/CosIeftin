// Persist a scraper run. Until now the ParseTally lived only in memory and vanished when
// the process exited, which is why "the run found fewer products" and "the run could not
// READ the products" looked identical the next morning.
import { prisma } from "./db";
import type { TallySummary } from "./price/parseTally";

export type RunOutcome = {
  /** JSON bucket census for this merchant, written by matchPoolToCatalog */
  censusJson?: string | null;
  merchantId: number;
  startedAt: Date;
  tally?: TallySummary;
  offersRejected?: number;
  /**
   * OFFER ROWS ACTUALLY WRITTEN. Counted at the write site, never reported by the scraper.
   *
   * `tally.parsed` counts pool items that had a readable price, which is a different thing
   * entirely — a DCNeu run recorded 6,044 "parsed" and wrote zero offer rows, and every
   * check that read that field called it a success. A run that writes nothing is not a
   * successful run, whatever it says about itself.
   */
  offersWritten?: number;
  previousRunCount?: number;
  aborted?: boolean;
  abortReason?: string | null;
};

/** Record one scraper execution. Never throws — telemetry must not break a scrape. */
export async function recordScraperRun(o: RunOutcome): Promise<void> {
  try {
    await prisma.scraperRun.create({
      data: {
        merchantId: o.merchantId,
        startedAt: o.startedAt,
        finishedAt: new Date(),
        offersAttempted: o.tally?.attempted ?? 0,
        offersParsed: o.tally?.parsed ?? 0,
        offersNull: o.tally?.nulls ?? 0,
        offersRejected: o.offersRejected ?? 0,
        offersWritten: o.offersWritten ?? 0,
        previousRunCount: o.previousRunCount ?? 0,
        // A run that wrote NO offer rows is not a success, whatever it reported about
        // itself. Deriving this here rather than trusting the caller means no scraper can
        // mark itself green while producing nothing.
        aborted: (o.aborted ?? false) || (o.offersWritten ?? 0) === 0,
        abortReason: o.abortReason ?? null,
        nullSamples: o.tally?.samples?.length ? JSON.stringify(o.tally.samples) : null,
        censusJson: o.censusJson ?? null,
      },
    });
  } catch (e) {
    console.error(`[scraper-run] could not record run: ${(e as Error).message}`);
  }
}
