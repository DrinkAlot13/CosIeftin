// Nothing a sanity gate refuses is thrown away.
//
// THE PRINCIPLE, AND WHY IT CHANGED.
//
// The instinct behind every gate in this codebase was "reject implausible prices". Auchan
// disproved it. Offer 1905 held 28,14 from 6 August and was rewritten to 12,00 on 30 August
// — a 57% drop, past the gate. Re-scraped independently today through a different code path,
// the real price is 11,69. So 28,14 was the anomaly and 12,00 was the CORRECTION, and a gate
// anchored on stored history would have refused the correction and kept the anomaly.
//
// That is not a tuning problem. A gate that compares against stored history can only ever be
// as right as the data it compares against, and it is most likely to fire at exactly the
// moment a wrong value is being fixed. So no gate may DISCARD. A gate defers: it keeps the
// previously trusted value, and it records what it refused so a human can arbitrate.
//
// THE COST OF NOT DOING THIS WAS CONCRETE. CLAUDE.md has required PriceAnomaly writes since
// the first session, and exactly one of twelve merchant paths did it. When the 28,14 -> 12,00
// question came up, the refused values had been discarded, so answering it needed a fresh
// scrape. Documentation is not enforcement; this function is, because it lives inside the one
// write path every merchant now goes through.

import { prisma } from "./db";

/**
 * A wholly broken run would write one row per product. The run-level tripwires (null rate,
 * the 60% drop guard, the pool contract) already say "this run is broken" far louder, so the
 * per-item record is capped and the count is printed in full.
 */
export const MAX_PRE_OFFER_REFUSALS = 200;

export type Refusal = {
  /** Null when the value was refused before it could become an offer. */
  offerId: number | null;
  merchantId: number;
  /** The store's own name for the item — the only identity a pre-offer refusal has. */
  storeName: string | null;
  /** What the gate refused, in bani. 0 when no price could be parsed at all. */
  rejectedPriceBani: number;
  /** What was kept instead. Null when nothing was kept, which is the case worth seeing. */
  acceptedPriceBani: number | null;
  /** The exact source string, so a parser change can be replayed against the refusal. */
  rawPriceText: string | null;
  reason: string;
};

/**
 * Record one refusal. Never throws: a failure to record must not cost the run, but the run
 * must not silently stop recording either, so a failure is logged.
 */
export async function recordRefusal(r: Refusal): Promise<void> {
  try {
    await prisma.priceAnomaly.create({
      data: {
        offerId: r.offerId,
        merchantId: r.merchantId,
        storeName: r.storeName?.slice(0, 300) ?? null,
        rejectedPriceBani: r.rejectedPriceBani,
        acceptedPriceBani: r.acceptedPriceBani,
        rawPriceText: r.rawPriceText?.slice(0, 300) ?? null,
        reason: r.reason.slice(0, 300),
      },
    });
  } catch (e) {
    console.error(`  [anomaly] failed to record a refusal: ${(e as Error).message.slice(0, 120)}`);
  }
}
