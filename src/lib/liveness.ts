// IS THE SOURCE STILL ALIVE? A question no data guard asks.
//
// Metro and Mega Image returned zero products for three days and every check in the project
// reported healthy. The 60% drop guard worked exactly as designed: it refused each empty run
// and preserved the previous data rather than wiping it. So the data stayed correct, the
// merchant was dead, and NOTHING DISTINGUISHED THOSE TWO STATES. The stored offers still had
// prices, still had observation dates, still read as live.
//
// That is a different failure class from every other bug in this project. The others were
// wrong values, which a diff over the catalog will find. This was CORRECT DATA AND A SILENT
// ABSENCE — and for a site heading into an unattended soak, absence is the more dangerous of
// the two, because every correctness check keeps passing while the prices quietly age.
//
// So liveness is measured on its own axis and never inferred from the data:
//
//   • A RUN THAT ABORTED IS NOT A SUCCESS. The drop guard aborting is the system working;
//     it is also the system producing nothing. Both are true and only the second matters here.
//   • The evidence of a successful write is an OFFER ROW, not a run record. `lastScrapeAt` is
//     a claim the scraper makes about itself; `max(Offer.lastObservedAt)` is what actually
//     landed. When they disagree, the disagreement is the finding.

export const EXPECTED_CADENCE_HOURS = 24;

/**
 * Past this, a merchant is not "quiet", it is not reporting.
 *
 * The rule is the shorter of 48 hours and twice the expected cadence, so tightening the
 * cadence automatically tightens the alarm rather than leaving a stale constant behind.
 */
export const MAX_SILENCE_HOURS = Math.min(48, EXPECTED_CADENCE_HOURS * 2);

export type Liveness = {
  slug: string;
  name: string;
  /** Newest Offer.lastObservedAt for this merchant — evidence a row was actually written. */
  lastWriteAt: Date | null;
  /** What the scraper claims about itself. A claim, not evidence. */
  lastScrapeClaimAt: Date | null;
  hoursSinceWrite: number;
  /** lastScrapeAt is recent but nothing was written: the scraper ran and produced nothing. */
  claimsWithoutWrites: boolean;
  /** Consecutive most-recent runs that aborted or parsed nothing. */
  deadRunStreak: number;
  lastAbortReason: string | null;
  liveOffers: number;
  dead: boolean;
};

type MerchantRow = {
  id: number;
  slug: string;
  name: string;
  lastScrapeAt: Date | null;
};

/**
 * `offersWritten`, not `offersParsed`.
 *
 * offersParsed counts pool items that had a readable price. A DCNeu run recorded 6,044 of
 * those and wrote ZERO offer rows, and this check — reading offersParsed — called it a
 * success. The number that means "this run produced something" is the one counted at the
 * write site.
 */
type RunRow = { aborted: boolean; offersWritten: number; abortReason: string | null };

/**
 * The minimal Prisma surface this needs, so the same function serves a page, a CLI audit and
 * the pre-soak gate without three copies drifting apart.
 */
export type LivenessDeps = {
  merchants: () => Promise<MerchantRow[]>;
  newestObservedAt: (merchantId: number) => Promise<Date | null>;
  liveOfferCount: (merchantId: number) => Promise<number>;
  recentRuns: (merchantId: number, take: number) => Promise<RunRow[]>;
};

const HOUR = 3_600_000;

export async function computeLiveness(deps: LivenessDeps, now: Date = new Date()): Promise<Liveness[]> {
  const merchants = await deps.merchants();
  const out: Liveness[] = [];
  for (const m of merchants) {
    const [lastWriteAt, liveOffers, runs] = await Promise.all([
      deps.newestObservedAt(m.id),
      deps.liveOfferCount(m.id),
      deps.recentRuns(m.id, 5),
    ]);
    const hoursSinceWrite = lastWriteAt ? (now.getTime() - lastWriteAt.getTime()) / HOUR : Infinity;
    let deadRunStreak = 0;
    let lastAbortReason: string | null = null;
    for (const r of runs) {
      if (!r.aborted && r.offersWritten > 0) break;
      deadRunStreak++;
      if (lastAbortReason === null) lastAbortReason = r.abortReason ?? "0 parsed";
    }
    const claimHours = m.lastScrapeAt ? (now.getTime() - m.lastScrapeAt.getTime()) / HOUR : Infinity;
    out.push({
      slug: m.slug,
      name: m.name,
      lastWriteAt,
      lastScrapeClaimAt: m.lastScrapeAt,
      hoursSinceWrite,
      // The scraper says it ran recently and no row carries a matching observation date.
      claimsWithoutWrites: claimHours <= MAX_SILENCE_HOURS && hoursSinceWrite > MAX_SILENCE_HOURS,
      deadRunStreak,
      lastAbortReason,
      liveOffers,
      dead: hoursSinceWrite > MAX_SILENCE_HOURS,
    });
  }
  // Oldest first: the thing most likely to be broken is the thing you should see first.
  out.sort((a, b) => b.hoursSinceWrite - a.hoursSinceWrite);
  return out;
}

/** Human-readable age, or the fact that there is none. */
export function formatSilence(hours: number): string {
  if (!Number.isFinite(hours)) return "niciodată";
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${Math.floor(hours / 24)} zile`;
}
