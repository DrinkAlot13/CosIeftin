// Where did the offers go? One classifier, used by both `npm run census` and every scraper run.
//
// Live offers appeared to fall from ~32,000 to ~24,000 overnight. Several deliberate changes
// were supposed to reduce that number, and together they over-explained the drop — which is
// worse than either explanation alone, because a system that cannot account for its own missing
// rows will hide a genuine data loss inside a legitimate one.
//
// It did, exactly once: Carrefour's alcohol range collapsed from 1,196 live offers to 550, and
// the drop-guard let it through by NINE offers because its baseline had been overwritten by a
// different scraper on the same merchant.
//
// So every offer is attributed to exactly one bucket, and the buckets must sum to the total.
// `NO_REASON` must always be zero; if it is not, that is the finding.

/** An offer is stale once it has not been seen in a feed for this long. */
export const STALE_AFTER_DAYS = 3;

/**
 * Buckets in PRECEDENCE order. An offer can be stale AND out of stock; it lands in exactly one
 * bucket so the arithmetic means something, and the earlier reason wins because it is the more
 * fundamental one — an offer from a merchant nobody scraped is not meaningfully "out of stock",
 * we simply did not look. Overlap is reported separately so this does not hide it.
 */
export const BUCKETS = [
  "live",
  "merchant inactive",
  "merchant not scraped in last run",
  "quarantined (unresolved PriceAnomaly)",
  "flagged by a sanity gate",
  "expired (past promoValidTo)",
  "stale (not seen in a feed)",
  "out of stock",
  "price basis unknown (WITHOUT_VAT)",
  "no reason found",
] as const;
export type Bucket = (typeof BUCKETS)[number];

export type CensusRow = {
  merchantActive: boolean;
  merchantScrapedRecently: boolean;
  anomalies: number;
  flagged: boolean;
  isExpired: boolean;
  promoValidTo: Date | null;
  isStale: boolean;
  lastSeenAt: Date | null;
  lastSeen: Date;
  availability: string;
  stockStatus: string;
  vatBasis: string;
};

export function classifyOffer(r: CensusRow, now: Date): Bucket {
  if (!r.merchantActive) return "merchant inactive";
  if (!r.merchantScrapedRecently) return "merchant not scraped in last run";
  if (r.anomalies > 0) return "quarantined (unresolved PriceAnomaly)";
  if (r.flagged) return "flagged by a sanity gate";
  if (r.isExpired || (r.promoValidTo && r.promoValidTo < now)) return "expired (past promoValidTo)";

  const seen = r.lastSeenAt ?? r.lastSeen;
  const staleByAge = now.getTime() - seen.getTime() > STALE_AFTER_DAYS * 86_400_000;
  if (r.isStale || staleByAge) return "stale (not seen in a feed)";

  if (r.availability !== "in stock" || r.stockStatus === "OUT_OF_STOCK") return "out of stock";
  if (r.vatBasis !== "WITH_VAT") return "price basis unknown (WITHOUT_VAT)";
  return "live";
}

export type CensusTotals = Record<string, number>;

/** Tally a set of rows into buckets, and assert the arithmetic closes. */
export function tally(rows: CensusRow[], now = new Date()): { totals: CensusTotals; total: number; closes: boolean } {
  const totals: CensusTotals = {};
  for (const b of BUCKETS) totals[b] = 0;
  for (const r of rows) totals[classifyOffer(r, now)]++;
  const sum = Object.values(totals).reduce((a, b) => a + b, 0);
  return { totals, total: rows.length, closes: sum === rows.length };
}
