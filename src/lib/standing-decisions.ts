// DECISIONS THAT MUST SURVIVE A REWRITE.
//
// THE BUG THIS EXISTS FOR. `Offer.flagged` holds two completely different kinds of statement
// in one column:
//
//   a GATE'S JUDGEMENT ABOUT TODAY'S DATA — "this offer has no name of its own", "its unit
//   price disagrees with its peers". These are SUPPOSED to be recomputed every run, and when
//   the condition clears the flag should go. Across one nightly, 189 of 189 "no name" offers
//   had gained a name and 55 of 55 "unit price disagrees" had gained their own size. Those 244
//   un-flaggings were correct and the system working.
//
//   a STANDING DECISION — a human rejecting a pairing, a quarantine on prices a broken scraper
//   fabricated. These are not about today's data and must never be undone by a routine rewrite.
//
// Nothing distinguished them, so a re-scrape cleared both. One rejected pairing came back live,
// and two quarantined DCNeu rows — fabricated by the pre-fix scraper — went back on the site.
// 185 live offers currently carry an unresolved PriceAnomaly and are shown anyway.
//
// So standing decisions are RE-ASSERTED after every write, from their durable records, by this
// module — called inside `matchPoolToCatalog`, so no merchant and no future adapter can skip it.
// Same shape as `record-refusal` being the only writer of PriceAnomaly and being called from
// inside the shared path: a rule enforced only by documentation is enforced by nothing.

import { prisma } from "./db";

export type ReassertResult = {
  /** Offers re-flagged because a REJECTED MatchOverride forbids the pairing. */
  rejected: number;
  /** Offers re-flagged because they carry an unresolved PriceAnomaly. */
  quarantined: number;
};

/**
 * Is this merchant forbidden from attaching anything to this product?
 *
 * KEYED ON (merchant, product) AND NOT ON THE STORE NAME. The override table keys on
 * `slugify(storeName)`, and that field is not stable between scrapes: Freshful's
 * "Mici din carne de porc și vită 500g" came back as "Mici din carne de vită și oaie 500g" and
 * Sezamo's "Dr.Oetker Gelatina" as "Dr.Oetker Gelatina foi 10 g". Three of five keys stopped
 * matching, and the reject silently stopped applying — consulted and MISSED, not overruled.
 *
 * A reject says a human looked at this shop's item on this product page and said no. Reading it
 * at (merchant, product) is broader than the key implies, and that is the right direction to err:
 * a false miss costs a comparison, a false match publishes one product's price on another, and
 * CLAUDE.md is explicit those are not equally bad. A CONFIRM override on the specific store item
 * still wins, so a merchant that later stocks the real product can be paired deliberately.
 */
export async function rejectedPairs(merchantId: number): Promise<Set<number>> {
  const rows = await prisma.matchOverride.findMany({
    where: { merchantId, decision: "reject" },
    select: { productId: true },
  });
  return new Set(rows.map((r) => r.productId));
}

/**
 * Re-apply every standing decision for one merchant, after its offers have been written.
 *
 * Withholds rather than deletes, per the house rule. An offer that contradicts a reject is
 * flagged, not removed: the row and its provenance stay, and it simply reaches no page.
 */
export async function reassertStandingDecisions(merchantId: number): Promise<ReassertResult> {
  const forbidden = await rejectedPairs(merchantId);
  let rejected = 0;
  if (forbidden.size > 0) {
    const r = await prisma.offer.updateMany({
      where: { merchantId, productId: { in: [...forbidden] }, flagged: false },
      data: {
        flagged: true,
        flagReason: "withheld: a REJECTED MatchOverride forbids this merchant on this product",
      },
    });
    rejected = r.count;
  }

  // An offer with an unresolved anomaly is quarantined BY DEFINITION — that is what the census
  // has always meant by the word. It was true of the census and not of the display, so 185 such
  // offers were on the site.
  const withOpenAnomaly = await prisma.offer.findMany({
    where: { merchantId, flagged: false, anomalies: { some: { resolved: false } } },
    select: { id: true },
  });
  let quarantined = 0;
  if (withOpenAnomaly.length > 0) {
    const r = await prisma.offer.updateMany({
      where: { id: { in: withOpenAnomaly.map((o) => o.id) } },
      data: {
        flagged: true,
        flagReason: "withheld: an unresolved PriceAnomaly stands against this offer",
      },
    });
    quarantined = r.count;
  }

  return { rejected, quarantined };
}
