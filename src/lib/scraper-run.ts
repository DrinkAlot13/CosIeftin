// Persist a scraper run. Until now the ParseTally lived only in memory and vanished when
// the process exited, which is why "the run found fewer products" and "the run could not
// READ the products" looked identical the next morning.
import { prisma } from "./db";
import type { TallySummary } from "./price/parseTally";

export type RunOutcome = {
  merchantId: number;
  startedAt: Date;
  tally?: TallySummary;
  offersRejected?: number;
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
        previousRunCount: o.previousRunCount ?? 0,
        aborted: o.aborted ?? false,
        abortReason: o.abortReason ?? null,
        nullSamples: o.tally?.samples?.length ? JSON.stringify(o.tally.samples) : null,
      },
    });
  } catch (e) {
    console.error(`[scraper-run] could not record run: ${(e as Error).message}`);
  }
}
